import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	checkInSelectedMembers,
	KioskPartialCheckInError,
	KioskRequestError,
	lookupPreRegisteredEvacuee,
	registerKioskWalkIn
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
			return new Response(JSON.stringify({ evacuee_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			registerKioskWalkIn({ citizen_id: '1234567890123' }, photo, new Date().toISOString())
		).resolves.toEqual({ evacuee_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV' });
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
