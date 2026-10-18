import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKioskBanners, KIOSK_BANNERS_TIMEOUT_MS } from './kiosk-banners.api';

const slide = {
	id: 'kiosk_banner:01',
	title: 'Flu shots',
	caption: 'Free today',
	duration_sec: 10,
	image_url: '/api/v1/kiosk/banners/01/image?exp=1&sig=ab'
};

const feed = (banners: unknown[] = [slide]) =>
	new Response(JSON.stringify({ banners, fetched_at: '2026-10-15T00:00:00Z' }), { status: 200 });

describe('fetchKioskBanners', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('makes an uncached same-origin POST and returns the slides', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(feed());

		await expect(fetchKioskBanners(fetchFn)).resolves.toEqual([slide]);
		expect(fetchFn).toHaveBeenCalledWith(
			'/api/v1/kiosk/banners',
			expect.objectContaining({
				method: 'POST',
				cache: 'no-store',
				signal: expect.any(AbortSignal)
			})
		);
		expect(KIOSK_BANNERS_TIMEOUT_MS).toBe(3_000);
	});

	it('aborts after 3 seconds and returns no slides', async () => {
		vi.useFakeTimers();
		const fetchFn = vi.fn<typeof fetch>().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				})
		);

		const result = fetchKioskBanners(fetchFn);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNERS_TIMEOUT_MS - 1);
		expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		await expect(result).resolves.toEqual([]);
		expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});

	it.each([
		['unauthorized', new Response(null, { status: 401 })],
		['unavailable', new Response(null, { status: 503 })],
		['bad json', new Response('not json', { status: 200 })],
		['missing banners', new Response(JSON.stringify({ fetched_at: 'x' }), { status: 200 })],
		['bad slide shape', feed([{ id: 'a', title: 'T' }])],
		['duration below 3', feed([{ ...slide, duration_sec: 2 }])],
		['duration above 60', feed([{ ...slide, duration_sec: 61 }])]
	])('returns no slides when the feed is %s', async (_label, response) => {
		await expect(
			fetchKioskBanners(vi.fn<typeof fetch>().mockResolvedValue(response))
		).resolves.toEqual([]);
	});

	it('returns no slides on a network failure', async () => {
		await expect(
			fetchKioskBanners(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))
		).resolves.toEqual([]);
	});

	it('fetches again after an error instead of reusing it', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'));
		await fetchKioskBanners(fetchFn);
		fetchFn.mockResolvedValueOnce(feed());

		await expect(fetchKioskBanners(fetchFn)).resolves.toEqual([slide]);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('accepts a null caption', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(feed([{ ...slide, caption: null }]));
		await expect(fetchKioskBanners(fetchFn)).resolves.toEqual([{ ...slide, caption: null }]);
	});
});
