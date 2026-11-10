import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalBannersResult } from '../data/internal-banners.api';
import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
import { InternalBannerDisplayController } from './internal-banner-display.svelte.js';

const slide = (id: string, duration_sec = 5): KioskBannerSlide => ({
	id,
	title: `Title ${id}`,
	caption: null,
	duration_sec,
	image_url: `/img/${id}`
});

const ok = (...slides: KioskBannerSlide[]): InternalBannersResult => ({ kind: 'ok', slides });

function setup(initial: InternalBannersResult) {
	const fetchFn = vi.fn<() => Promise<InternalBannersResult>>().mockResolvedValue(initial);
	const controller = new InternalBannerDisplayController({ fetch: fetchFn });
	return { fetchFn, controller };
}

async function started(initial: InternalBannersResult) {
	const ctx = setup(initial);
	ctx.controller.start();
	await vi.advanceTimersByTimeAsync(0);
	return ctx;
}

describe('InternalBannerDisplayController', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('is loading before the first fetch resolves, then plays the first slide', async () => {
		const { controller } = setup(ok(slide('a', 5), slide('b', 7)));
		expect(controller.status).toBe('loading');

		controller.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(controller.status).toBe('playing');
		expect(controller.current?.id).toBe('a');
		controller.destroy();
	});

	it('advances after each duration_sec and loops back to the first slide', async () => {
		const { controller } = await started(ok(slide('a', 5), slide('b', 7)));

		await vi.advanceTimersByTimeAsync(4_999);
		expect(controller.current?.id).toBe('a');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.current?.id).toBe('b');

		await vi.advanceTimersByTimeAsync(6_999);
		expect(controller.current?.id).toBe('b');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.current?.id).toBe('a');

		await vi.advanceTimersByTimeAsync(5_000);
		expect(controller.current?.id).toBe('b');
		controller.destroy();
	});

	it('refetches every 5 minutes and swaps a lone slide immediately', async () => {
		const { controller, fetchFn } = await started(ok(slide('a', 5)));
		fetchFn.mockResolvedValue(ok(slide('c', 5)));

		await vi.advanceTimersByTimeAsync(299_999);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(controller.current?.id).toBe('a');
		await vi.advanceTimersByTimeAsync(1);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(controller.current?.id).toBe('c');
		controller.destroy();
	});

	it('applies a changed list at the next slide boundary when several slides play', async () => {
		// a(5s) + b(6s) cycle every 11 s, so at t=300 s the display is on 'a' until t=302 s.
		const { controller, fetchFn } = await started(ok(slide('a', 5), slide('b', 6)));
		fetchFn.mockResolvedValue(ok(slide('c', 5), slide('d', 6)));

		await vi.advanceTimersByTimeAsync(300_000);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(controller.current?.id).toBe('a');

		await vi.advanceTimersByTimeAsync(1_999);
		expect(controller.current?.id).toBe('a');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.current?.id).toBe('c');
		controller.destroy();
	});

	it('keeps playing the current slides when a refresh errors and retries next round', async () => {
		const { controller, fetchFn } = await started(ok(slide('a', 5), slide('b', 6)));
		fetchFn.mockResolvedValueOnce({ kind: 'error' });

		await vi.advanceTimersByTimeAsync(300_000);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(controller.status).toBe('playing');
		expect(controller.slides.map((s) => s.id)).toEqual(['a', 'b']);

		fetchFn.mockResolvedValue(ok(slide('c', 5), slide('d', 6)));
		await vi.advanceTimersByTimeAsync(300_000);

		expect(fetchFn).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(11_000);
		expect(controller.slides.map((s) => s.id)).toEqual(['c', 'd']);
		controller.destroy();
	});

	it('switches to invalid_code on not_found and stops all timers', async () => {
		const { controller, fetchFn } = await started(ok(slide('a', 5), slide('b', 6)));
		fetchFn.mockResolvedValue({ kind: 'not_found' });

		await vi.advanceTimersByTimeAsync(300_000);

		expect(controller.status).toBe('invalid_code');
		expect(controller.current).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('is invalid_code straight away when the first fetch is not_found', async () => {
		const { controller, fetchFn } = await started({ kind: 'not_found' });

		expect(controller.status).toBe('invalid_code');
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('shows empty for a feed with no slides, keeps refreshing, and plays once slides arrive', async () => {
		const { controller, fetchFn } = await started(ok());
		expect(controller.status).toBe('empty');
		expect(controller.current).toBeNull();

		await vi.advanceTimersByTimeAsync(300_000);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(controller.status).toBe('empty');

		fetchFn.mockResolvedValue(ok(slide('a', 5), slide('b', 7)));
		await vi.advanceTimersByTimeAsync(300_000);

		expect(controller.status).toBe('playing');
		expect(controller.current?.id).toBe('a');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(controller.current?.id).toBe('b');
		controller.destroy();
	});

	it('goes empty immediately when a refresh returns no slides while playing', async () => {
		const { controller, fetchFn } = await started(ok(slide('a', 5), slide('b', 6)));
		fetchFn.mockResolvedValue(ok());

		await vi.advanceTimersByTimeAsync(300_000);

		expect(controller.status).toBe('empty');
		expect(controller.current).toBeNull();
		controller.destroy();
	});

	it('destroy clears all timers and stops refreshing', async () => {
		const { controller, fetchFn } = await started(ok(slide('a', 5), slide('b', 7)));
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		controller.destroy();

		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('ignores a fetch that resolves after destroy', async () => {
		let resolveFetch: (r: InternalBannersResult) => void = () => {};
		const fetchFn = vi.fn<() => Promise<InternalBannersResult>>(
			() => new Promise((resolve) => (resolveFetch = resolve))
		);
		const controller = new InternalBannerDisplayController({ fetch: fetchFn });
		controller.start();
		controller.destroy();

		resolveFetch(ok(slide('a', 5), slide('b', 7)));
		await vi.advanceTimersByTimeAsync(0);

		expect(controller.status).toBe('loading');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('onInvalid fires on not_found', async () => {
		const onInvalid = vi.fn();
		const fetchFn = vi
			.fn<() => Promise<InternalBannersResult>>()
			.mockResolvedValue({ kind: 'not_found' });
		const controller = new InternalBannerDisplayController({ fetch: fetchFn, onInvalid });

		controller.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(onInvalid).toHaveBeenCalledTimes(1);
		controller.destroy();
	});

	it('a not_found that resolves after destroy() does not call onInvalid', async () => {
		const onInvalid = vi.fn();
		let resolveFetch: (r: InternalBannersResult) => void = () => {};
		const fetchFn = vi.fn<() => Promise<InternalBannersResult>>(
			() => new Promise((resolve) => (resolveFetch = resolve))
		);
		const controller = new InternalBannerDisplayController({ fetch: fetchFn, onInvalid });
		controller.start();
		controller.destroy();

		resolveFetch({ kind: 'not_found' });
		await vi.advanceTimersByTimeAsync(0);

		expect(onInvalid).not.toHaveBeenCalled();
	});

	it('retries a first-load error after 10s, 20s, 40s, then every 60s, showing connecting', async () => {
		const { controller, fetchFn } = await started({ kind: 'error' });
		expect(controller.status).toBe('connecting');
		expect(fetchFn).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(9_999);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchFn).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(19_999);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchFn).toHaveBeenCalledTimes(3);

		await vi.advanceTimersByTimeAsync(39_999);
		expect(fetchFn).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchFn).toHaveBeenCalledTimes(4);

		await vi.advanceTimersByTimeAsync(59_999);
		expect(fetchFn).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchFn).toHaveBeenCalledTimes(5);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchFn).toHaveBeenCalledTimes(6);
		expect(controller.status).toBe('connecting');
		controller.destroy();
	});

	it('plays as soon as a retry succeeds, and later errors only wait for the 5-minute refresh', async () => {
		const { controller, fetchFn } = await started({ kind: 'error' });
		fetchFn.mockResolvedValueOnce({ kind: 'error' });
		await vi.advanceTimersByTimeAsync(10_000);
		expect(controller.status).toBe('connecting');

		fetchFn.mockResolvedValue(ok(slide('a', 5), slide('b', 6)));
		await vi.advanceTimersByTimeAsync(20_000);
		expect(controller.status).toBe('playing');
		expect(controller.current?.id).toBe('a');
		expect(fetchFn).toHaveBeenCalledTimes(3);

		fetchFn.mockResolvedValue({ kind: 'error' });
		await vi.advanceTimersByTimeAsync(300_000);
		expect(fetchFn).toHaveBeenCalledTimes(4);
		expect(controller.status).toBe('playing');
		expect(controller.slides.map((s) => s.id)).toEqual(['a', 'b']);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchFn).toHaveBeenCalledTimes(4);
		controller.destroy();
	});

	it('shows empty (not connecting) once the feed answered, even if later refreshes error', async () => {
		const { controller, fetchFn } = await started(ok());
		fetchFn.mockResolvedValue({ kind: 'error' });

		await vi.advanceTimersByTimeAsync(300_000);

		expect(controller.status).toBe('empty');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		controller.destroy();
	});

	it('a not_found after first-load errors stops the retry timer', async () => {
		const { controller, fetchFn } = await started({ kind: 'error' });
		fetchFn.mockResolvedValue({ kind: 'not_found' });

		await vi.advanceTimersByTimeAsync(10_000);

		expect(controller.status).toBe('invalid_code');
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('destroy clears the retry timer while connecting', async () => {
		const { controller, fetchFn } = await started({ kind: 'error' });
		expect(controller.status).toBe('connecting');

		controller.destroy();

		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
