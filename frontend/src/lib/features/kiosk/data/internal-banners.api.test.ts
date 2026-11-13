import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchInternalBanners, INTERNAL_BANNERS_TIMEOUT_MS } from './internal-banners.api';

const slide = {
	id: 'kiosk_banner:01',
	title: 'Flu shots',
	caption: 'Free today',
	duration_sec: 10,
	image_url: '/api/v1/kiosk/internal/shelter-1/banners/01/image?exp=1&sig=ab'
};

const feed = (banners: unknown[] = [slide]) =>
	new Response(JSON.stringify({ banners, fetched_at: '2026-10-15T00:00:00Z' }), { status: 200 });

describe('fetchInternalBanners', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('resolves a 200 feed to ok with the parsed slides', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(feed());

		await expect(fetchInternalBanners('shelter-1', '123456', fetchFn)).resolves.toEqual({
			kind: 'ok',
			slides: [slide]
		});
	});

	it('makes an uncached GET with the shelter and code url-encoded', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(feed());

		await fetchInternalBanners('shelter/1 a', '12&34', fetchFn);

		expect(fetchFn).toHaveBeenCalledWith(
			'/api/v1/kiosk/internal/shelter%2F1%20a/banners?c=12%2634',
			expect.objectContaining({
				method: 'GET',
				cache: 'no-store',
				signal: expect.any(AbortSignal)
			})
		);
	});

	it('resolves a 404 to not_found', async () => {
		const response = new Response(JSON.stringify({ code: 'TV_CODE_NOT_FOUND' }), { status: 404 });

		await expect(
			fetchInternalBanners('shelter-1', '000000', vi.fn<typeof fetch>().mockResolvedValue(response))
		).resolves.toEqual({ kind: 'not_found' });
	});

	it.each([
		['unavailable', new Response(null, { status: 503 })],
		['a server error', new Response(null, { status: 500 })],
		['bad json', new Response('not json', { status: 200 })],
		['missing banners', new Response(JSON.stringify({ fetched_at: 'x' }), { status: 200 })],
		['bad slide shape', feed([{ id: 'a', title: 'T' }])],
		['duration below 3', feed([{ ...slide, duration_sec: 2 }])]
	])('resolves to error when the feed is %s', async (_label, response) => {
		await expect(
			fetchInternalBanners('shelter-1', '123456', vi.fn<typeof fetch>().mockResolvedValue(response))
		).resolves.toEqual({ kind: 'error' });
	});

	it('resolves to error on a network failure', async () => {
		await expect(
			fetchInternalBanners(
				'shelter-1',
				'123456',
				vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
			)
		).resolves.toEqual({ kind: 'error' });
	});

	it('aborts after 3 seconds and resolves to error', async () => {
		vi.useFakeTimers();
		const fetchFn = vi.fn<typeof fetch>().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				})
		);

		const result = fetchInternalBanners('shelter-1', '123456', fetchFn);
		await vi.advanceTimersByTimeAsync(2_999);
		expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		await expect(result).resolves.toEqual({ kind: 'error' });
		expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
		expect(INTERNAL_BANNERS_TIMEOUT_MS).toBe(3_000);
	});
});
