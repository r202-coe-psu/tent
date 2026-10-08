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
		expect(bodies[0]).not.toHaveProperty('photo');
		expect(bodies[0]).not.toHaveProperty('source');
		expect(bodies[1]).toEqual({
			primary_evacuee_id: primaryId,
			evacuee_ids: [others[2], primaryId],
			source: 'smart-card',
			citizen_id: '1234567890123',
			photo
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
