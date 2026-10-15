import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
import {
	KIOSK_BANNER_IDLE_MS,
	KIOSK_BANNER_REFRESH_MS,
	KioskBannerAttractController
} from './kiosk-banner-attract.svelte.js';

const slide = (id: string, duration_sec = 10): KioskBannerSlide => ({
	id,
	title: `Title ${id}`,
	caption: null,
	duration_sec,
	image_url: `/img/${id}`
});

function setup(initial: KioskBannerSlide[]) {
	const fetchFn = vi.fn<() => Promise<KioskBannerSlide[]>>().mockResolvedValue(initial);
	const controller = new KioskBannerAttractController({ fetch: fetchFn });
	return { fetchFn, controller };
}

async function started(initial: KioskBannerSlide[]) {
	const ctx = setup(initial);
	ctx.controller.start();
	await vi.advanceTimersByTimeAsync(0);
	return ctx;
}

describe('KioskBannerAttractController', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('uses a 30 s idle window and a 5 min refresh', () => {
		expect(KIOSK_BANNER_IDLE_MS).toBe(30_000);
		expect(KIOSK_BANNER_REFRESH_MS).toBe(300_000);
	});

	it('stays hidden when there are no banners, even after 30 s', async () => {
		const { controller } = await started([]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS * 2);
		expect(controller.phase).toBe('hidden');
		expect(controller.current).toBeNull();
		controller.destroy();
	});

	it('arms when banners arrive and shows the first slide after 30 s idle', async () => {
		const { controller } = await started([slide('a'), slide('b')]);
		expect(controller.phase).toBe('armed');
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS - 1);
		expect(controller.phase).toBe('armed');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.phase).toBe('showing');
		expect(controller.current?.id).toBe('a');
		controller.destroy();
	});

	it('restarts the idle window on activity', async () => {
		const { controller } = await started([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS - 1_000);
		controller.recordActivity();
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS - 1);
		expect(controller.phase).toBe('armed');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.phase).toBe('showing');
		controller.destroy();
	});

	it('dismiss returns to armed and shows again after another 30 s', async () => {
		const { controller } = await started([slide('a'), slide('b')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		controller.dismiss();
		expect(controller.phase).toBe('armed');
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS - 1);
		expect(controller.phase).toBe('armed');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.phase).toBe('showing');
		expect(controller.current?.id).toBe('a');
		controller.destroy();
	});

	it('does not rotate after dismiss', async () => {
		const { controller } = await started([slide('a', 5), slide('b', 5)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		controller.dismiss();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(controller.index).toBe(0);
		controller.destroy();
	});

	it('rotates using each slide own duration and wraps around', async () => {
		const { controller } = await started([slide('a', 5), slide('b', 20), slide('c', 3)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		expect(controller.current?.id).toBe('a');
		await vi.advanceTimersByTimeAsync(4_999);
		expect(controller.current?.id).toBe('a');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.current?.id).toBe('b');
		await vi.advanceTimersByTimeAsync(19_999);
		expect(controller.current?.id).toBe('b');
		await vi.advanceTimersByTimeAsync(1);
		expect(controller.current?.id).toBe('c');
		await vi.advanceTimersByTimeAsync(3_000);
		expect(controller.current?.id).toBe('a');
		controller.destroy();
	});

	it('sets no rotation timer for a single slide', async () => {
		const { controller } = await started([slide('a', 3)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		// only the refresh interval remains
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(controller.current?.id).toBe('a');
		controller.destroy();
	});

	it('picks up a new list on the 5 min refresh while armed', async () => {
		const { controller, fetchFn } = await started([slide('a')]);
		fetchFn.mockResolvedValue([slide('x'), slide('y')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_REFRESH_MS);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(controller.slides.map((s) => s.id)).toEqual(['x', 'y']);
		controller.destroy();
	});

	it('arms when a refresh brings banners while hidden', async () => {
		const { controller, fetchFn } = await started([]);
		fetchFn.mockResolvedValue([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_REFRESH_MS);
		expect(controller.phase).toBe('armed');
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		expect(controller.phase).toBe('showing');
		controller.destroy();
	});

	it('hides and stops idle when a refresh returns an empty list while armed', async () => {
		const { controller, fetchFn } = await started([slide('a')]);
		fetchFn.mockResolvedValue([]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_REFRESH_MS);
		expect(controller.phase).toBe('hidden');
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS * 2);
		expect(controller.phase).toBe('hidden');
		controller.destroy();
	});

	it('applies a refreshed list at the next slide change while showing', async () => {
		// 7 s slides: the 5 min refresh (270 s into showing) lands 4 s into a slide, 3 s before the next
		const { controller, fetchFn } = await started([slide('a', 7), slide('b', 7)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		fetchFn.mockResolvedValue([slide('c', 7), slide('d', 7)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_REFRESH_MS - KIOSK_BANNER_IDLE_MS);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(controller.phase).toBe('showing');
		expect(controller.slides.map((s) => s.id)).toEqual(['a', 'b']);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(controller.slides.map((s) => s.id)).toEqual(['c', 'd']);
		expect(controller.current?.id).toBe('c');
		controller.destroy();
	});

	it('hides when the list becomes empty while showing', async () => {
		const { controller, fetchFn } = await started([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		fetchFn.mockResolvedValue([]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_REFRESH_MS - KIOSK_BANNER_IDLE_MS);
		expect(controller.phase).toBe('hidden');
		expect(controller.current).toBeNull();
		controller.destroy();
	});

	it('applies a new list immediately while showing a single slide', async () => {
		const { controller, fetchFn } = await started([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		fetchFn.mockResolvedValue([slide('a'), slide('b', 4)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_REFRESH_MS - KIOSK_BANNER_IDLE_MS);
		expect(controller.slides.map((s) => s.id)).toEqual(['a', 'b']);
		expect(controller.current?.id).toBe('a');
		await vi.advanceTimersByTimeAsync(10_000);
		expect(controller.current?.id).toBe('b');
		controller.destroy();
	});

	it('skips a broken slide while showing', async () => {
		const { controller } = await started([slide('a', 5), slide('b', 5)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		controller.markBroken('a');
		expect(controller.current?.id).toBe('b');
		expect(controller.slides.map((s) => s.id)).toEqual(['b']);
		controller.destroy();
	});

	it('keeps the current slide when a different slide breaks', async () => {
		const { controller } = await started([slide('a', 5), slide('b', 5), slide('c', 5)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS + 5_000);
		expect(controller.current?.id).toBe('b');
		controller.markBroken('a');
		expect(controller.current?.id).toBe('b');
		controller.destroy();
	});

	it('hides when every slide is broken', async () => {
		const { controller } = await started([slide('a'), slide('b')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		controller.markBroken('a');
		controller.markBroken('b');
		expect(controller.phase).toBe('hidden');
		expect(controller.current).toBeNull();
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS * 2);
		expect(controller.phase).toBe('hidden');
		controller.destroy();
	});

	it('hides when every slide is broken while armed', async () => {
		const { controller } = await started([slide('a')]);
		controller.markBroken('a');
		expect(controller.phase).toBe('hidden');
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS * 2);
		expect(controller.phase).toBe('hidden');
		controller.destroy();
	});

	it('ignores a fetch that resolves after destroy', async () => {
		const { controller } = setup([slide('a')]);
		controller.start();
		controller.destroy();
		await vi.advanceTimersByTimeAsync(0);
		expect(controller.phase).toBe('hidden');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('destroy clears every timer', async () => {
		const { controller } = await started([slide('a', 5), slide('b', 5)]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		controller.destroy();
		expect(vi.getTimerCount()).toBe(0);
	});
});
