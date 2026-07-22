import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	donationIpLimiter: { check: vi.fn(() => true) },
	donationPhoneLimiter: { check: vi.fn(() => true) }
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
		SECRET_RECAPTCHA_KEY: 'dummy-secret',
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
	beforeEach(() => {
		vi.resetAllMocks();
		vi.unstubAllGlobals();
		vi.mocked(donationIpLimiter.check).mockReturnValue(true);
		vi.mocked(donationPhoneLimiter.check).mockReturnValue(true);
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
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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
	});

	it('forwards shelter_pickup logistics to FastAPI', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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

		const logistics = {
			delivery_method: 'shelter_pickup',
			vehicle: 'car',
			eta: '2026-06-27T10:00:00Z',
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
	});

	it('returns 409 NEED_FULL if the item need target is already fully met', async () => {
		// Mock needs recheck: target is 50, but we already have 50 or more donated
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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

	it('returns 409 NEED_FULL when the requested qty exceeds the remaining quota', async () => {
		// target 50, already 48 declared → only 2 left, but payload asks for 5
		vi.mocked(adminRaw).mockImplementation(needsMock(50, 48));

		const response = await POST({
			request: { json: () => Promise.resolve(validPayload) },
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.error).toBe('NEED_FULL');
		expect(data.item_id).toBe('item:rice');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('accepts the booking when the requested qty exactly fits the remaining quota', async () => {
		// target 50, already 45 declared → exactly 5 left, payload asks for 5
		vi.mocked(adminRaw).mockImplementation(needsMock(50, 45));

		const response = await POST({
			request: { json: () => Promise.resolve(validPayload) },
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(putAsPublicWriter).toHaveBeenCalled();
	});

	it('returns 409 SLOT_FULL if the logistics slot is already fully booked', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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
						status: 'open'
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
});
