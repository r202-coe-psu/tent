import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageStore } from '$lib/stores/language.svelte';
import { mintConsentStamp, type ConsentDecision } from '$lib/features/consent/server';
import { personQrVerdictMessage } from '$lib/utils/evacuee-qr';
import {
	checkInSelectedMembers,
	KioskPartialCheckInError,
	KioskRequestError,
	lookupPreRegisteredEvacuee,
	registerKioskThaidWalkIn,
	reprintKioskLabels,
	registerKioskWalkIn,
	requestError
} from './kiosk-check-in.api';

describe('checkInSelectedMembers batching', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('sends selections in sequential batches of at most twenty and merges the results', async () => {
		const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
		const selectedIds = Array.from(
			{ length: 45 },
			(_, index) => `evacuee:${String(index).padStart(26, '0')}`
		);
		const batches: string[][] = [];
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as {
				primary_evacuee_id: string;
				evacuee_ids: string[];
			};
			expect(body.primary_evacuee_id).toBe(primaryId);
			batches.push(body.evacuee_ids);
			return new Response(
				JSON.stringify({
					shelter_code: 'SH001',
					members: body.evacuee_ids.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' }))
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		const response = await checkInSelectedMembers(primaryId, selectedIds, { batchLimit: 20 });

		expect(batches.map((batch) => batch.length)).toEqual([20, 20, 5]);
		expect(batches.flat()).toEqual(selectedIds);
		expect(response).toEqual({
			shelter_code: 'SH001',
			members: selectedIds.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' })),
			retryable_evacuee_ids: []
		});
	});

	it('caps every request at twenty even when no batch limit is provided', async () => {
		const selectedIds = Array.from({ length: 25 }, (_, index) => `evacuee:${index}`);
		const batchSizes: number[] = [];
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { evacuee_ids: string[] };
			batchSizes.push(body.evacuee_ids.length);
			return new Response(
				JSON.stringify({
					shelter_code: 'SH001',
					members: body.evacuee_ids.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' }))
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		const response = await checkInSelectedMembers('evacuee:primary', selectedIds);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(batchSizes).toEqual([20, 5]);
		expect(response.retryable_evacuee_ids).toEqual([]);
	});

	it('moves the primary into the first batch of a household over twenty', async () => {
		const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
		const others = Array.from(
			{ length: 24 },
			(_, index) => `evacuee:${String(index).padStart(26, '0')}`
		);
		const batches: string[][] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as { evacuee_ids: string[] };
				batches.push(body.evacuee_ids);
				return new Response(
					JSON.stringify({
						shelter_code: 'SH001',
						members: body.evacuee_ids.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' }))
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			})
		);

		const response = await checkInSelectedMembers(primaryId, [...others, primaryId]);

		expect(batches.map((batch) => batch.length)).toEqual([20, 5]);
		expect(batches[0][0]).toBe(primaryId);
		expect(batches.flat().sort()).toEqual([...others, primaryId].sort());
		expect(response.retryable_evacuee_ids).toEqual([]);
	});

	it('preserves completed batches and exposes retryable ids when a later batch fails', async () => {
		const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
		const selectedIds = Array.from({ length: 45 }, (_, index) => `evacuee:${index}`);
		let requestCount = 0;
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requestCount += 1;
			const body = JSON.parse(String(init?.body)) as { evacuee_ids: string[] };
			if (requestCount === 1) {
				return new Response(
					JSON.stringify({
						shelter_code: 'SH001',
						members: body.evacuee_ids.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' }))
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			return new Response(
				JSON.stringify({ error: { code: 'TEMPORARY_FAILURE', message: 'ลองอีกครั้ง' } }),
				{ status: 503, headers: { 'content-type': 'application/json' } }
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(checkInSelectedMembers(primaryId, selectedIds)).rejects.toMatchObject({
			name: KioskPartialCheckInError.name,
			result: {
				shelter_code: 'SH001',
				members: selectedIds.slice(0, 20).map((evacuee_id) => ({
					evacuee_id,
					status: 'checked_in'
				})),
				retryable_evacuee_ids: selectedIds.slice(20)
			}
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('converts an aborted ten-second phone lookup into a retryable timeout error', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('aborted', 'AbortError')),
						{ once: true }
					);
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const pending = lookupPreRegisteredEvacuee({ source: 'phone', phone: '0812345678' }).then(
			(value) => ({ value }),
			(error: unknown) => ({ error })
		);
		await vi.advanceTimersByTimeAsync(10_000);
		const outcome = await pending;
		const caught = 'error' in outcome ? outcome.error : null;
		expect(caught).toBeInstanceOf(KioskRequestError);
		expect(caught).toMatchObject({
			name: 'KioskRequestError',
			status: 0,
			code: 'TIMEOUT'
		});
	});
});

describe('checkInSelectedMembers card photo', () => {
	afterEach(() => vi.unstubAllGlobals());

	const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
	const photo = {
		content_type: 'image/jpeg' as const,
		full_base64: '/9j/4A==',
		width: 1,
		height: 1,
		original_size: 4,
		compressed_size: 4,
		thumbnail_size: 0
	};

	function captureBodies(): Array<Record<string, unknown>> {
		const bodies: Array<Record<string, unknown>> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
					evacuee_ids: string[];
				};
				bodies.push(body);
				return new Response(
					JSON.stringify({
						shelter_code: 'SH001',
						members: body.evacuee_ids.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' }))
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			})
		);
		return bodies;
	}

	it('omits source, citizen_id and photo when no photo is given', async () => {
		const bodies = captureBodies();
		await checkInSelectedMembers(primaryId, [primaryId]);
		expect(bodies).toEqual([{ primary_evacuee_id: primaryId, evacuee_ids: [primaryId] }]);
	});

	it('sends the photo with the smart-card source only on the batch holding the card owner', async () => {
		const others = Array.from(
			{ length: 3 },
			(_, index) => `evacuee:${String(index).padStart(26, '0')}`
		);
		const bodies = captureBodies();
		await checkInSelectedMembers(primaryId, [...others, primaryId], {
			batchLimit: 2,
			photo,
			citizenId: '1234567890123'
		});
		expect(bodies).toHaveLength(2);
		expect(bodies[0]).toEqual({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId, others[0]],
			source: 'smart-card',
			citizen_id: '1234567890123',
			photo
		});
		expect(bodies[1]).not.toHaveProperty('photo');
		expect(bodies[1]).not.toHaveProperty('source');
		expect(bodies[1]).toMatchObject({ evacuee_ids: [others[1], others[2]] });
	});
});

describe('checkInSelectedMembers ThaiD session', () => {
	afterEach(() => vi.unstubAllGlobals());

	const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
	const sessionId = '0123456789abcdef0123456789abcdef';

	it('sends the primary first, with the thaid session on that batch only (never a citizen id)', async () => {
		const others = Array.from(
			{ length: 3 },
			(_, index) => `evacuee:${String(index).padStart(26, '0')}`
		);
		const bodies: Array<Record<string, unknown>> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
					evacuee_ids: string[];
				};
				bodies.push(body);
				return new Response(
					JSON.stringify({
						shelter_code: 'SH001',
						members: body.evacuee_ids.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' }))
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			})
		);

		await checkInSelectedMembers(primaryId, [...others, primaryId], {
			batchLimit: 2,
			thaidSessionId: sessionId
		});

		expect(bodies).toEqual([
			{
				primary_evacuee_id: primaryId,
				evacuee_ids: [primaryId, others[0]],
				source: 'thaid',
				thaid_session_id: sessionId,
				photo: null
			},
			{ primary_evacuee_id: primaryId, evacuee_ids: [others[1], others[2]] }
		]);
	});
});

describe('lookupPreRegisteredEvacuee ThaiD gate', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('sends only the source and session id, never a citizen id', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => {
			return new Response(JSON.stringify({ kind: 'kiosk_registered', shelter_code: 'SH001' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await lookupPreRegisteredEvacuee({
			source: 'thaid',
			session_id: '0123456789abcdef0123456789abcdef'
		});

		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
			source: 'thaid',
			session_id: '0123456789abcdef0123456789abcdef'
		});
	});
});

const registered = {
	evacuee_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
	qr_payload: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
	label: { name: 'สมชาย ใจดี', phone: '0812345678' },
	consent_ref: 'CS-0123456Z',
	consent_mode: 'full'
};
const decision: ConsentDecision = {
	mode: 'full',
	health: false,
	search_visible: true,
	guardian_for: [],
	verbal: false,
	...mintConsentStamp()
};

describe('lookupPreRegisteredEvacuee QR errors (CR-233)', () => {
	afterEach(() => vi.unstubAllGlobals());

	function stub(status: number, body: unknown) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(body), { status }))
		);
	}

	it('turns KIOSK_QR_EXPIRED into Bangkok-dated copy and exposes the dates', async () => {
		stub(409, {
			error: {
				code: 'KIOSK_QR_EXPIRED',
				message: 'server text',
				issued_at: '2026-11-03T02:10:00.000Z',
				current_printed_at: '2026-11-05T09:41:12.512Z'
			}
		});
		const error = await lookupPreRegisteredEvacuee({
			source: 'qr',
			token: 'evacuee:X@289170'
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(KioskRequestError);
		const err = error as KioskRequestError;
		expect(err.status).toBe(409);
		expect(err.code).toBe('KIOSK_QR_EXPIRED');
		expect(err.details).toEqual({
			issued_at: '2026-11-03T02:10:00.000Z',
			current_printed_at: '2026-11-05T09:41:12.512Z'
		});
		expect(err.message).toBe(
			personQrVerdictMessage({
				status: 'expired',
				issued_at: '2026-11-03T02:10:00.000Z',
				current_printed_at: '2026-11-05T09:41:12.512Z'
			})
		);
		expect(err.message).toContain('QR นี้ออกวันที่');
		expect(err.message).toContain('มีใบใหม่วันที่');
		expect(err.message).not.toContain('server text');
	});

	it('uses the pre-change copy when issued_at is null', async () => {
		stub(409, {
			error: {
				code: 'KIOSK_QR_EXPIRED',
				issued_at: null,
				current_printed_at: '2026-11-05T09:41:12.512Z'
			}
		});
		const err = (await lookupPreRegisteredEvacuee({ source: 'qr', token: 'evacuee:X' }).catch(
			(e: unknown) => e
		)) as KioskRequestError;
		expect(err.message).toContain('QR นี้ออกก่อนเปลี่ยนระบบ');
		expect(err.details?.issued_at).toBeNull();
	});

	it('shows "QR ไม่ถูกต้อง" for KIOSK_QR_INVALID', async () => {
		stub(400, { error: { code: 'KIOSK_QR_INVALID', message: 'x' } });
		await expect(
			lookupPreRegisteredEvacuee({ source: 'qr', token: 'evacuee:X@ffffff' })
		).rejects.toMatchObject({ status: 400, code: 'KIOSK_QR_INVALID', message: 'QR ไม่ถูกต้อง' });
	});
});

describe('registerKioskWalkIn', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('sends compressed photo separately from card data', async () => {
		const photo = {
			content_type: 'image/webp' as const,
			full_base64: 'UklGRgAAAABXRUJQ',
			width: 300,
			height: 400,
			original_size: 10,
			compressed_size: 12,
			thumbnail_size: 0
		};
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as {
				card: Record<string, unknown>;
				photo: unknown;
			};
			expect(body.card).not.toHaveProperty('photo_base64');
			expect(body.photo).toEqual(photo);
			return new Response(JSON.stringify(registered), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			registerKioskWalkIn({ citizen_id: '1234567890123' }, photo, decision)
		).resolves.toEqual(registered);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('sends the phone with a card registration', async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			expect(body).toEqual({
				source: 'smart-card',
				card: { citizen_id: '1234567890123' },
				photo: null,
				phone: '0812345678',
				consent: decision,
				consented_at: decision.given_at
			});
			return new Response(JSON.stringify(registered), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await registerKioskWalkIn({ citizen_id: '1234567890123' }, null, decision, '0812345678');
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});

describe('registerKioskThaidWalkIn', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('sends only the session id, consent and phone', async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(JSON.parse(String(init?.body))).toEqual({
				source: 'thaid',
				session_id: 'a'.repeat(32),
				phone: null,
				consent: decision,
				consented_at: decision.given_at
			});
			return new Response(JSON.stringify(registered), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(registerKioskThaidWalkIn('a'.repeat(32), decision, null)).resolves.toEqual(
			registered
		);
	});

	it('surfaces an expired ThaiD session as its error code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: { code: 'KIOSK_THAID_SESSION_INVALID', message: 'กรุณาสแกนใหม่' }
						}),
						{ status: 409 }
					)
			)
		);

		await expect(registerKioskThaidWalkIn('a'.repeat(32), decision, null)).rejects.toMatchObject({
			status: 409,
			code: 'KIOSK_THAID_SESSION_INVALID'
		});
	});
});

describe('reprintKioskLabels', () => {
	afterEach(() => vi.unstubAllGlobals());

	const input = {
		phone: '0812345678',
		primary_evacuee_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
		id_last4: '0123',
		evacuee_ids: ['evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV']
	};

	it('posts the verification to the reprint endpoint and returns the labels', async () => {
		const members = [
			{
				evacuee_id: input.primary_evacuee_id,
				qr_payload: input.primary_evacuee_id,
				label: { name: 'สมชาย ใจดี', phone: '0812345678', zone: 'A3', stations_passed: 3 }
			}
		];
		const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
			void args;
			return new Response(JSON.stringify({ shelter_code: 'SH001', members }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await reprintKioskLabels(input)).toEqual({ shelter_code: 'SH001', members });

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/v1/kiosk/reprint');
		expect(init?.method).toBe('POST');
		expect(JSON.parse(String(init?.body))).toEqual(input);
	});

	it('maps an error response to a KioskRequestError with its code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: { code: 'KIOSK_REPRINT_VERIFY_FAILED', message: 'เลข 4 หลักท้ายไม่ถูกต้อง' }
						}),
						{ status: 403 }
					)
			)
		);

		await expect(reprintKioskLabels(input)).rejects.toMatchObject({
			name: 'KioskRequestError',
			status: 403,
			code: 'KIOSK_REPRINT_VERIFY_FAILED',
			message: 'เลข 4 หลักท้ายไม่ถูกต้อง'
		});
	});
});

describe('checkInSelectedMembers lookup time (CR-192)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';

	function stubFetch(bodies: Record<string, unknown>[]) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
					evacuee_ids: string[];
				};
				bodies.push(body);
				return new Response(
					JSON.stringify({
						shelter_code: 'SH001',
						members: body.evacuee_ids.map((evacuee_id) => ({ evacuee_id, status: 'checked_in' }))
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			})
		);
	}

	it('sends the lookup time as lookup_at with every batch', async () => {
		const bodies: Record<string, unknown>[] = [];
		stubFetch(bodies);
		const lookupAt = '2026-10-25T03:00:00.000Z';
		const ids = [
			primaryId,
			...Array.from({ length: 24 }, (_, i) => `evacuee:${String(i).padStart(26, '0')}`)
		];

		await checkInSelectedMembers(primaryId, ids, { batchLimit: 20, lookupAt });

		expect(bodies).toHaveLength(2);
		for (const body of bodies) expect(body.lookup_at).toBe(lookupAt);
	});

	it('omits lookup_at when none is given', async () => {
		const bodies: Record<string, unknown>[] = [];
		stubFetch(bodies);

		await checkInSelectedMembers(primaryId, [primaryId]);

		expect(bodies[0]).not.toHaveProperty('lookup_at');
	});
});

describe('kiosk request messages language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('builds the partial check-in message in English', () => {
		languageStore.setLanguage('en');

		const error = new KioskPartialCheckInError({
			shelter_code: 'SH001',
			members: [],
			retryable_evacuee_ids: []
		});

		expect(error.message).toBe(
			'Only part of the check-in went through. Please review the results and retry the rest'
		);
	});

	it('keeps the Thai partial check-in message in Thai', () => {
		const error = new KioskPartialCheckInError({
			shelter_code: 'SH001',
			members: [],
			retryable_evacuee_ids: []
		});

		expect(error.message).toBe('รายงานตัวได้บางส่วน กรุณาตรวจผลและลองรายการที่เหลืออีกครั้ง');
	});

	it('uses an English generic message when the server sent none', async () => {
		languageStore.setLanguage('en');

		const error = await requestError(new Response('{}', { status: 500 }));

		expect(error.message).toBe('The system could not complete this request');
	});

	function errorResponse(status: number, error: Record<string, unknown>): Response {
		return new Response(JSON.stringify({ error }), { status });
	}

	it('words a known server error code in English instead of the Thai server text', async () => {
		languageStore.setLanguage('en');

		const error = await requestError(
			errorResponse(503, {
				code: 'DEPENDENCY_UNAVAILABLE',
				message: 'บริการค้นหาข้อมูลไม่พร้อมใช้งาน'
			})
		);

		expect(error.message).toBe(
			'The service is not available right now. Please try again or contact staff.'
		);
		expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
	});

	it('words a closed kiosk in English rather than falling back to the generic message', async () => {
		languageStore.setLanguage('en');

		const error = await requestError(
			errorResponse(403, { code: 'KIOSK_CLOSED', message: 'ตู้นี้ปิดให้บริการ' })
		);

		expect(error.message).toBe('This kiosk is closed right now.');
		expect(error.code).toBe('KIOSK_CLOSED');
	});

	it('falls back to the English generic message for a code it has no English for', async () => {
		languageStore.setLanguage('en');

		const error = await requestError(
			errorResponse(500, { code: 'SOMETHING_NEW', message: 'ข้อความไทยจาก server' })
		);

		expect(error.message).toBe('The system could not complete this request');
	});

	it('keeps the Thai server text on the Thai screen', async () => {
		const error = await requestError(
			errorResponse(503, {
				code: 'DEPENDENCY_UNAVAILABLE',
				message: 'บริการค้นหาข้อมูลไม่พร้อมใช้งาน'
			})
		);

		expect(error.message).toBe('บริการค้นหาข้อมูลไม่พร้อมใช้งาน');
	});

	it('words an invalid QR in English', async () => {
		languageStore.setLanguage('en');

		const error = await requestError(
			errorResponse(400, { code: 'KIOSK_QR_INVALID', message: 'QR ไม่ถูกต้อง' })
		);

		expect(error.message).toBe('Invalid QR');
	});

	it('words an expired QR in English with its dates', async () => {
		languageStore.setLanguage('en');

		const error = await requestError(
			errorResponse(409, {
				code: 'KIOSK_QR_EXPIRED',
				message: 'QR นี้หมดอายุแล้ว',
				issued_at: '2026-01-01T03:00:00.000Z',
				current_printed_at: '2026-01-02T03:00:00.000Z'
			})
		);

		expect(error.message).toMatch(/^This QR was issued on .+\. A new one was issued on .+\./);
		expect(error.message).not.toMatch(/[\u0E00-\u0E7F]/);
	});
});
