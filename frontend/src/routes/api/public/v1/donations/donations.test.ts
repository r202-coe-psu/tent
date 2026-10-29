import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken() {
			return Promise.resolve(true);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SECRET_RECAPTCHA_KEY: 'test-recaptcha-secret',
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

function mockFastapiCreate(body: Record<string, unknown> = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				success: true,
				tracking_token: 'TX-SH001-TESTTOK1',
				booking_ref: 'DN-123456',
				...body
			})
		})
	);
}

describe('POST /api/public/v1/donations', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	beforeEach(() => {
		vi.resetAllMocks();
		vi.unstubAllGlobals();
		// The fixtures book 2026-06-27; pin "now" before it so they stay in the future
		// (past dates are refused). Only Date is faked — timers/promises stay real.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-06-01T03:00:00Z'));
	});

	const validPayload = {
		shelter_code: 'SH001',
		donor: {
			name: 'John Doe',
			phone: '0812345678',
			line_id: 'john_line',
			email: 'john@example.com'
		},
		items: [
			{
				item_id: 'item:rice',
				free_text: 'ข้าวสาร',
				qty: 5,
				unit: 'kg',
				category: 'food',
				condition: 'new',
				note: 'บริจาคช่วยผู้ประสบภัย'
			}
		],
		logistics: {
			delivery_method: 'self_dropoff',
			vehicle: 'car',
			eta: '2026-06-27T10:00:00Z'
		},
		captchaToken: 'dummy-token'
	};

	it('creates a donation via FastAPI buffer when input is valid', async () => {
		// Mock needs recheck: remaining need is plenty (100 kg)
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			// Shelter validation: registry lookup
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: 100, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});
		mockFastapiCreate();

		const mockRequest = {
			json: () => Promise.resolve(validPayload)
		};

		const response = await POST({
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.trackingToken).toBe('TX-SH001-TESTTOK1');
		expect(data.bookingRef).toBe('DN-123456');
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/donations',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					Authorization: 'Bearer test-external-secret'
				})
			})
		);
		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const body = JSON.parse(String((init as RequestInit).body));
		expect(body.campaign_id).toBe('donation_campaign:c1');
		// No window picked → nothing for FastAPI's slot counter to hold.
		expect(body.slot_hold).toBeUndefined();
	});

	it('forwards shelter_pickup logistics to FastAPI', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: 100, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			// A pickup needs a published truck window to book into.
			if (method === 'GET' && path.includes('donation_slot')) {
				return Promise.resolve({ status: 200, data: { capacity: 2, status: 'open', to: '11:00' } });
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});
		mockFastapiCreate();

		const logistics = {
			delivery_method: 'shelter_pickup',
			vehicle: 'car',
			eta: '2026-06-27T10:00:00Z',
			slot: { date: '2026-06-27', from: '10:00', to: '11:00' },
			pickup_address: '123/45 Sukhumvit Rd, Bangkok'
		};
		const mockRequest = {
			json: () => Promise.resolve({ ...validPayload, logistics })
		};

		const response = await POST({
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const body = JSON.parse(String((init as RequestInit).body));
		expect(body.logistics.delivery_method).toBe('shelter_pickup');
		expect(body.logistics.pickup_address).toBe('123/45 Sukhumvit Rd, Bangkok');
		// A capped window goes to FastAPI as a hold: its counter makes the SLOT_FULL call
		// the CouchDB count above cannot make atomically.
		expect(body.slot_hold).toEqual({
			mode: 'pickup',
			date: '2026-06-27',
			from: '10:00',
			capacity: 2,
			booked: 0
		});
	});

	it('sends no slot hold for an uncapped drop-off window', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({ status: 200, data: { rows: [] } });
			}
			// Opening hours with no ceiling (FR-DS-3): the window never fills.
			if (method === 'GET' && path.includes('donation_slot')) {
				return Promise.resolve({
					status: 200,
					data: { capacity: null, status: 'open', to: '10:00' }
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({ status: 200, data: { rows: [] } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});
		mockFastapiCreate();

		const response = await POST({
			request: {
				json: () =>
					Promise.resolve({
						...validPayload,
						logistics: {
							delivery_method: 'self_dropoff',
							slot: { date: '2026-06-27', from: '09:00', to: '10:00' }
						}
					})
			},
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		expect(response.status).toBe(200);
		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const body = JSON.parse(String((init as RequestInit).body));
		expect(body.slot_hold).toBeUndefined();
	});

	it('passes a FastAPI SLOT_FULL through when the counter refuses the last place', async () => {
		// The CouchDB count still read the window open — the booking that took the last
		// place has not synced yet. FastAPI's counter saw it and refused.
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({ status: 200, data: { rows: [] } });
			}
			if (method === 'GET' && path.includes('donation_slot')) {
				return Promise.resolve({ status: 200, data: { capacity: 1, status: 'open', to: '10:00' } });
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({ status: 200, data: { rows: [] } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});
		// FastAPI's error envelope wraps the HTTPException detail in `errors[]`.
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 409,
				json: async () => ({ success: false, errors: [{ success: false, error: 'SLOT_FULL' }] })
			})
		);

		const response = await POST({
			request: {
				json: () =>
					Promise.resolve({
						...validPayload,
						logistics: {
							delivery_method: 'self_dropoff',
							slot: { date: '2026-06-27', from: '09:00', to: '10:00' }
						}
					})
			},
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.error).toBe('SLOT_FULL');
	});

	it('returns 409 NEED_FULL if the item need target is already fully met', async () => {
		// Mock needs recheck: target is 50, but we already have 50 or more donated
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: 50, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation:d1',
									type: 'donation',
									campaign_id: 'donation_campaign:c1',
									status: 'declared',
									items: [{ item_id: 'item:rice', qty: 50 }]
								}
							}
						]
					}
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			json: () => Promise.resolve(validPayload)
		};

		const response = await POST({
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.success).toBe(false);
		expect(data.error).toBe('NEED_FULL');
		expect(data.item_id).toBe('item:rice');
	});

	// Race guard: a concurrent donor consumed most of the quota before this
	// submission read state. The re-check must reject when the requested qty
	// exceeds what remains — not only when the need is fully closed.
	function needsMock(qtyTarget: number, existingDeclaredQty: number) {
		return (path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: qtyTarget, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation:d1',
									type: 'donation',
									campaign_id: 'donation_campaign:c1',
									status: 'declared',
									items: [{ item_id: 'item:rice', qty: existingDeclaredQty }]
								}
							}
						]
					}
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		};
	}

	/**
	 * Two open campaigns want rice: c1 has 90 left, c2 has 500. The board sums them into
	 * 590, but a donation carries one campaign_id, so binding to whichever came first
	 * refused a 200 kg gift while c2 sat on quota nobody could reach.
	 */
	function twoRiceCampaignsMock(firstTarget: number, secondTarget: number) {
		return (path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: firstTarget, unit: 'kg' }]
								}
							},
							{
								doc: {
									_id: 'donation_campaign:c2',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: secondTarget, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({ status: 200, data: { rows: [] } });
			}
			return Promise.resolve({ status: 404, data: {} });
		};
	}

	it('routes a donation to a campaign that can take it, not merely the first', async () => {
		vi.mocked(adminRaw).mockImplementation(twoRiceCampaignsMock(90, 500));
		mockFastapiCreate();

		const response = await POST({
			request: {
				json: () =>
					Promise.resolve({
						...validPayload,
						items: [{ item_id: 'item:rice', free_text: 'ข้าวสาร', qty: '200', unit: 'kg' }]
					})
			},
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		expect(response.status).toBe(200);
		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const body = JSON.parse(String((init as RequestInit).body));
		expect(body.campaign_id).toBe('donation_campaign:c2');
	});

	it('refuses a qty only reachable by splitting across campaigns', async () => {
		// 90 + 500 shows as 590 on the board; no single booking can draw on both.
		vi.mocked(adminRaw).mockImplementation(twoRiceCampaignsMock(90, 500));
		mockFastapiCreate();

		const response = await POST({
			request: {
				json: () =>
					Promise.resolve({
						...validPayload,
						items: [{ item_id: 'item:rice', free_text: 'ข้าวสาร', qty: '550', unit: 'kg' }]
					})
			},
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		expect(response.status).toBe(409);
		expect((await response.json()).error).toBe('NEED_FULL');
	});

	it('returns 409 NEED_FULL when the requested qty exceeds the remaining quota', async () => {
		// target 50, already 48 declared → only 2 left, but payload asks for 5
		vi.mocked(adminRaw).mockImplementation(needsMock(50, 48));
		mockFastapiCreate();

		const response = await POST({
			request: { json: () => Promise.resolve(validPayload) },
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.error).toBe('NEED_FULL');
		expect(data.item_id).toBe('item:rice');
		// Rejected before the write path — nothing reaches the FastAPI intake buffer.
		expect(fetch).not.toHaveBeenCalled();
	});

	it('accepts the booking when the requested qty exactly fits the remaining quota', async () => {
		// target 50, already 45 declared → exactly 5 left, payload asks for 5
		vi.mocked(adminRaw).mockImplementation(needsMock(50, 45));
		mockFastapiCreate();

		const response = await POST({
			request: { json: () => Promise.resolve(validPayload) },
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/donations',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('returns 409 SLOT_FULL if the logistics slot is already fully booked', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [] }
				});
			}
			if (method === 'GET' && path.includes('donation_slot')) {
				return Promise.resolve({
					status: 200,
					data: {
						capacity: 1,
						status: 'open',
						to: '10:00'
					}
				});
			}
			if (method === 'GET' && path.includes('donation')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation:d1',
									type: 'donation',
									status: 'declared',
									logistics: {
										slot: { date: '2026-06-27', from: '09:00', to: '10:00' }
									}
								}
							}
						]
					}
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			json: () =>
				Promise.resolve({
					...validPayload,
					logistics: {
						delivery_method: 'self_dropoff',
						slot: { date: '2026-06-27', from: '09:00', to: '10:00' }
					}
				})
		};

		const response = await POST({
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.success).toBe(false);
		expect(data.error).toBe('SLOT_FULL');
	});

	it.each(['pending_review', 'verifying'])(
		'counts a %s booking against the slot, not just declared ones',
		async (status) => {
			// CR-052 opens every public booking at pending_review, so a slot filled by the
			// wizard holds none of its places under a declared-only count — capacity would
			// read as free forever and SLOT_FULL would never fire (schema.md §2.13).
			vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
				if (method === 'GET' && path.includes('donation_campaign:')) {
					return Promise.resolve({ status: 200, data: { rows: [] } });
				}
				if (method === 'GET' && path.includes('donation_slot')) {
					return Promise.resolve({
						status: 200,
						data: { capacity: 1, status: 'open', to: '10:00' }
					});
				}
				if (method === 'GET' && path.includes('donation')) {
					return Promise.resolve({
						status: 200,
						data: {
							rows: [
								{
									doc: {
										_id: 'donation:d1',
										type: 'donation',
										status,
										logistics: { slot: { date: '2026-06-27', from: '09:00', to: '10:00' } }
									}
								}
							]
						}
					});
				}
				return Promise.resolve({ status: 404, data: {} });
			});

			const response = await POST({
				request: {
					json: () =>
						Promise.resolve({
							...validPayload,
							logistics: {
								delivery_method: 'self_dropoff',
								slot: { date: '2026-06-27', from: '09:00', to: '10:00' }
							}
						})
				},
				getClientAddress: () => '127.0.0.1'
			} as unknown as PostEvent);

			const data = await response.json();
			expect(response.status).toBe(409);
			expect(data.error).toBe('SLOT_FULL');
		}
	);

	it('returns 422 if input schema validation fails', async () => {
		const invalidPayload = {
			...validPayload,
			donor: { name: '', phone: '' } // missing name and phone
		};

		const mockRequest = {
			json: () => Promise.resolve(invalidPayload)
		};

		const response = await POST({
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(422);
		expect(data.success).toBe(false);
	});

	async function postItems(items: unknown) {
		const mockRequest = { json: () => Promise.resolve({ ...validPayload, items }) };
		const response = await POST({
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);
		return { response, data: await response.json() };
	}

	it.each([0, '0', -1, ''])('returns 422 when an item qty is %j (#822)', async (qty) => {
		const { response, data } = await postItems([{ ...validPayload.items[0], qty }]);
		expect(response.status).toBe(422);
		expect(data.success).toBe(false);
	});

	it('returns 422 for an empty items list (#822)', async () => {
		const { response, data } = await postItems([]);
		expect(response.status).toBe(422);
		expect(data.success).toBe(false);
		expect(JSON.stringify(data)).toContain('Please add at least one item to the donation');
	});

	it('returns 422 when logistics is missing (required for public channel)', async () => {
		const noLogistics = { ...validPayload };
		delete (noLogistics as Partial<typeof validPayload>).logistics;
		const mockRequest = {
			json: () => Promise.resolve(noLogistics)
		};

		const response = await POST({
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(422);
		expect(data.success).toBe(false);
	});

	describe('shelter validation now lives in FastAPI (CR-017 §Decision A)', () => {
		function mockEmptyCouch() {
			vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: { rows: [] } });
		}

		function mockFastapiError(status: number, detail: Record<string, unknown>) {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status,
					json: async () => ({ errors: [detail] })
				})
			);
		}

		it('surfaces SHELTER_NOT_FOUND from the FastAPI error envelope', async () => {
			mockEmptyCouch();
			mockFastapiError(404, {
				success: false,
				error: 'SHELTER_NOT_FOUND',
				shelter_code: 'SH999'
			});

			const response = await POST({
				request: { json: () => Promise.resolve({ ...validPayload, shelter_code: 'SH999' }) },
				getClientAddress: () => '127.0.0.1'
			} as unknown as PostEvent);

			const data = await response.json();
			expect(response.status).toBe(404);
			expect(data.success).toBe(false);
			expect(data.error).toBe('SHELTER_NOT_FOUND');
			expect(data.shelter_code).toBe('SH999');
		});

		it('surfaces SHELTER_CLOSED from the FastAPI error envelope', async () => {
			mockEmptyCouch();
			mockFastapiError(409, { success: false, error: 'SHELTER_CLOSED', shelter_code: 'SH001' });

			const response = await POST({
				request: { json: () => Promise.resolve(validPayload) },
				getClientAddress: () => '127.0.0.1'
			} as unknown as PostEvent);

			const data = await response.json();
			expect(response.status).toBe(409);
			expect(data.error).toBe('SHELTER_CLOSED');
		});

		it('never reads the shelter registry from CouchDB', async () => {
			mockEmptyCouch();
			mockFastapiCreate();

			await POST({
				request: { json: () => Promise.resolve(validPayload) },
				getClientAddress: () => '127.0.0.1'
			} as unknown as PostEvent);

			// config:app is allowed (reCAPTCHA operator flag); shelter master docs are not.
			const registryReads = vi
				.mocked(adminRaw)
				.mock.calls.filter(
					(c) => String(c[0]).includes('/registry') && !String(c[0]).includes('config%3Aapp')
				);
			expect(registryReads).toHaveLength(0);
		});
	});
	describe('slot re-check per queue', () => {
		const SLOT = { date: '2026-06-27', from: '09:00', to: '10:00' };

		/** CouchDB as the route reads it: no campaigns, `bookings`, and a slot lookup. */
		function couch(opts: {
			bookings?: Record<string, unknown>[];
			/** Status of the `donation:` `_all_docs` read (default 200). */
			donationsStatus?: number;
			slot?: (path: string) => { status: number; data: unknown };
		}) {
			vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
				if (method !== 'GET') return Promise.resolve({ status: 404, data: {} });
				if (path.includes('donation_campaign:')) {
					return Promise.resolve({ status: 200, data: { rows: [] } });
				}
				if (path.includes('donation_slot')) {
					return Promise.resolve(opts.slot?.(path) ?? { status: 404, data: {} });
				}
				if (path.includes('donation')) {
					const status = opts.donationsStatus ?? 200;
					if (status >= 400) return Promise.resolve({ status, data: {} });
					return Promise.resolve({
						status,
						data: { rows: (opts.bookings ?? []).map((doc) => ({ doc })) }
					});
				}
				return Promise.resolve({ status: 404, data: {} });
			});
		}

		async function submit(logistics: Record<string, unknown>) {
			const response = await POST({
				request: { json: () => Promise.resolve({ ...validPayload, logistics }) },
				getClientAddress: () => '127.0.0.1'
			} as unknown as PostEvent);
			return { status: response.status, body: await response.json() };
		}

		it('refuses a pickup with no window — a truck trip only exists where one was published', async () => {
			couch({});
			const res = await submit({ delivery_method: 'shelter_pickup', pickup_address: '1/1' });
			expect(res.status).toBe(422);
			expect(res.body.error).toBe('SLOT_REQUIRED');
		});

		it('refuses a pickup into a window the shelter never published', async () => {
			couch({ slot: () => ({ status: 404, data: {} }) });
			const res = await submit({
				delivery_method: 'shelter_pickup',
				pickup_address: '1/1',
				slot: SLOT
			});
			expect(res.status).toBe(409);
			expect(res.body.error).toBe('SLOT_UNAVAILABLE');
		});

		it('fails closed when the slot lookup itself fails', async () => {
			couch({ slot: () => ({ status: 500, data: {} }) });
			const res = await submit({ delivery_method: 'self_dropoff', slot: SLOT });
			expect(res.status).toBe(503);
			expect(res.body.error).toBe('SLOTS_UNAVAILABLE');
		});

		it('fails closed (503) when the booking list cannot be read — an outage is not "nothing booked"', async () => {
			mockFastapiCreate();
			couch({ donationsStatus: 500, slot: () => ({ status: 404, data: {} }) });
			const res = await submit({ delivery_method: 'self_dropoff', slot: SLOT });
			expect(res.status).toBe(503);
			expect(res.body.error).toBe('SLOTS_UNAVAILABLE');
			// Nothing may have been created behind a failed count.
			expect(fetch).not.toHaveBeenCalled();
		});

		it('treats a missing shelter database (404) on the booking read as no bookings', async () => {
			mockFastapiCreate();
			couch({ donationsStatus: 404, slot: () => ({ status: 404, data: {} }) });
			const res = await submit({ delivery_method: 'self_dropoff', slot: SLOT });
			expect(res.status).toBe(200);
		});

		it('refuses a window whose end differs from the one the shelter published', async () => {
			// Same date + start (so the same doc id), but a longer window than published.
			couch({
				slot: () => ({
					status: 200,
					data: { capacity: null, status: 'open', date: SLOT.date, from: SLOT.from, to: '10:00' }
				})
			});
			const res = await submit({
				delivery_method: 'self_dropoff',
				slot: { ...SLOT, to: '12:00' }
			});
			expect(res.status).toBe(409);
			expect(res.body.error).toBe('SLOT_UNAVAILABLE');
		});

		it('accepts a window that matches the published doc exactly', async () => {
			mockFastapiCreate();
			couch({
				slot: () => ({
					status: 200,
					data: { capacity: 2, status: 'open', date: SLOT.date, from: SLOT.from, to: SLOT.to }
				})
			});
			const res = await submit({ delivery_method: 'self_dropoff', slot: SLOT });
			expect(res.status).toBe(200);
		});

		it('refuses a date that is already past in Asia/Bangkok', async () => {
			// 2026-06-01T20:00Z is already 2026-06-02 03:00 in Bangkok.
			vi.setSystemTime(new Date('2026-06-01T20:00:00Z'));
			couch({ slot: () => ({ status: 404, data: {} }) });
			const res = await submit({
				delivery_method: 'self_dropoff',
				slot: { date: '2026-06-01', from: '09:00', to: '10:00' }
			});
			expect(res.status).toBe(409);
			expect(res.body.error).toBe('SLOT_UNAVAILABLE');
		});

		it('accepts today in Asia/Bangkok even while UTC is still on the previous day', async () => {
			mockFastapiCreate();
			vi.setSystemTime(new Date('2026-06-26T20:00:00Z')); // 2026-06-27 03:00 Bangkok
			couch({ slot: () => ({ status: 404, data: {} }) });
			const res = await submit({ delivery_method: 'self_dropoff', slot: SLOT });
			expect(res.status).toBe(200);
		});

		it.each([
			['date not YYYY-MM-DD', { date: '27/06/2026', from: '09:00', to: '10:00' }],
			['date that does not exist', { date: '2026-02-31', from: '09:00', to: '10:00' }],
			['start not HH:mm', { date: '2026-06-27', from: '9:00', to: '10:00' }],
			['end not HH:mm', { date: '2026-06-27', from: '09:00', to: '10' }],
			['end before start', { date: '2026-06-27', from: '10:00', to: '09:00' }],
			['end equal to start', { date: '2026-06-27', from: '09:00', to: '09:00' }],
			['id-injecting start', { date: '2026-06-27', from: '09:00/../x', to: '10:00' }]
		])('rejects a malformed slot with 422 before touching CouchDB: %s', async (_label, slot) => {
			couch({});
			const res = await submit({ delivery_method: 'self_dropoff', slot });
			expect(res.status).toBe(422);
			expect(adminRaw).not.toHaveBeenCalled();
		});

		it('finds a drop-off window written before the split under its old id', async () => {
			couch({
				bookings: [
					{
						_id: 'donation:d1',
						type: 'donation',
						status: 'pending_review',
						logistics: { delivery_method: 'self_dropoff', slot: SLOT }
					}
				],
				// Only the legacy id `donation_slot:{date}:{from}` exists, full at 1.
				slot: (path) =>
					path.includes(encodeURIComponent('donation_slot:2026-06-27:09:00'))
						? { status: 200, data: { capacity: 1, status: 'open', to: '10:00' } }
						: { status: 404, data: {} }
			});
			const res = await submit({ delivery_method: 'self_dropoff', slot: SLOT });
			expect(res.status).toBe(409);
			expect(res.body.error).toBe('SLOT_FULL');
		});

		it('accepts a non-standard drop-off hour backed by a legacy-id doc (fallback hit is not re-checked)', async () => {
			mockFastapiCreate();
			couch({
				slot: (path) =>
					path.includes(encodeURIComponent('donation_slot:2026-06-27:03:00'))
						? { status: 200, data: { capacity: null, status: 'open', to: '04:00' } }
						: { status: 404, data: {} }
			});
			const res = await submit({
				delivery_method: 'self_dropoff',
				slot: { date: '2026-06-27', from: '03:00', to: '04:00' }
			});
			expect(res.status).toBe(200);
		});

		it('refuses a drop-off outside the standard windows when no override doc exists (AC-DS-11)', async () => {
			couch({ slot: () => ({ status: 404, data: {} }) });
			const res = await submit({
				delivery_method: 'self_dropoff',
				slot: { date: '2026-06-27', from: '03:00', to: '04:00' }
			});
			expect(res.status).toBe(409);
			expect(res.body.error).toBe('SLOT_UNAVAILABLE');
		});

		it('refuses a drop-off whose start matches a standard window but whose end does not', async () => {
			couch({ slot: () => ({ status: 404, data: {} }) });
			const res = await submit({
				delivery_method: 'self_dropoff',
				slot: { date: '2026-06-27', from: '09:00', to: '11:00' }
			});
			expect(res.status).toBe(409);
			expect(res.body.error).toBe('SLOT_UNAVAILABLE');
		});

		it('accepts a drop-off in a standard window with no doc behind it', async () => {
			mockFastapiCreate();
			couch({ slot: () => ({ status: 404, data: {} }) });
			const res = await submit({ delivery_method: 'self_dropoff', slot: SLOT });
			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});

		it('does not count a drop-off booking against the truck at the same hour', async () => {
			mockFastapiCreate();
			couch({
				bookings: [
					{
						_id: 'donation:d1',
						type: 'donation',
						status: 'pending_review',
						logistics: { delivery_method: 'self_dropoff', slot: SLOT }
					}
				],
				slot: () => ({ status: 200, data: { capacity: 1, status: 'open', to: '10:00' } })
			});
			const res = await submit({
				delivery_method: 'shelter_pickup',
				pickup_address: '1/1',
				slot: SLOT
			});
			expect(res.body.error).not.toBe('SLOT_FULL');
			expect(res.body.success).toBe(true);
		});
	});

	describe('vehicle plate', () => {
		function mockCouch() {
			vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
				if (method === 'GET' && path.includes('donation_campaign:')) {
					return Promise.resolve({ status: 200, data: { rows: [] } });
				}
				if (method === 'GET' && path.includes('donation:')) {
					return Promise.resolve({ status: 200, data: { rows: [] } });
				}
				return Promise.resolve({ status: 404, data: {} });
			});
		}

		async function submit(logistics: Record<string, unknown>) {
			mockCouch();
			mockFastapiCreate();
			return POST({
				request: { json: () => Promise.resolve({ ...validPayload, logistics }) },
				getClientAddress: () => '127.0.0.1'
			} as unknown as PostEvent);
		}

		const forwardedLogistics = () => {
			const [, init] = vi.mocked(fetch).mock.calls[0]!;
			return JSON.parse(String((init as RequestInit).body)).logistics;
		};

		it('forwards a trimmed plate to FastAPI for a self drop-off', async () => {
			const response = await submit({
				delivery_method: 'self_dropoff',
				vehicle: 'motorcycle',
				vehicle_plate: '  กข 1234 กรุงเทพมหานคร '
			});
			expect(response.status).toBe(200);
			expect(forwardedLogistics().vehicle_plate).toBe('กข 1234 กรุงเทพมหานคร');
		});

		it('omits a blank plate', async () => {
			await submit({ delivery_method: 'self_dropoff', vehicle: 'car', vehicle_plate: '   ' });
			expect(forwardedLogistics()).not.toHaveProperty('vehicle_plate');
		});

		it('rejects a plate on shelter_pickup with 422', async () => {
			const response = await submit({
				delivery_method: 'shelter_pickup',
				vehicle_plate: 'กข 1234'
			});
			expect(response.status).toBe(422);
		});
	});
});
