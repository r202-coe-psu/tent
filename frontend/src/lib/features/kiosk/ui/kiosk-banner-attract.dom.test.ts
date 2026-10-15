// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
import { fetchKioskBanners } from '../data/kiosk-banners.api';
import { KIOSK_BANNER_IDLE_MS } from './kiosk-banner-attract.svelte.js';
import KioskBannerAttract from './kiosk-banner-attract.svelte';

vi.mock('../data/kiosk-banners.api', () => ({ fetchKioskBanners: vi.fn() }));

const slide = (id: string, over: Partial<KioskBannerSlide> = {}): KioskBannerSlide => ({
	id,
	title: `Title ${id}`,
	caption: null,
	duration_sec: 10,
	image_url: `/img/${id}`,
	...over
});

const overlay = () => document.querySelector('[data-testid="kiosk-banner-attract"]');
const gone = () => overlay() === null;
const tap = (target: Element) =>
	target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

let instance: ReturnType<typeof mount> | null = null;
let card: HTMLButtonElement;
let onCardClick: () => void;

async function mountLive(banners: KioskBannerSlide[]) {
	vi.mocked(fetchKioskBanners).mockResolvedValue(banners);
	instance = mount(KioskBannerAttract, { target: document.body, props: { mode: 'live' } });
	await vi.advanceTimersByTimeAsync(0);
	flushSync();
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	// happy-dom has no Web Animations API; Svelte transitions need it. Finish them at once.
	Element.prototype.animate = function () {
		const animation = {
			onfinish: null as (() => void) | null,
			cancel() {},
			finish() {},
			currentTime: 0
		};
		queueMicrotask(() => animation.onfinish?.());
		return animation as unknown as Animation;
	};
	onCardClick = vi.fn();
	card = document.createElement('button');
	card.addEventListener('click', onCardClick);
	document.body.append(card);
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('KioskBannerAttract live (DOM)', () => {
	it('renders nothing when the feed is empty, however long the kiosk idles', async () => {
		await mountLive([]);

		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS * 2);

		expect(overlay()).toBeNull();
	});

	it('shows the overlay after the idle period, and not before', async () => {
		await mountLive([slide('a')]);

		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS - 1);
		expect(overlay()).toBeNull();

		await vi.advanceTimersByTimeAsync(1);
		flushSync();
		expect(overlay()).not.toBeNull();
	});

	it('restarts the idle countdown on a touch outside the overlay', async () => {
		await mountLive([slide('a')]);

		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS - 1_000);
		tap(card);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS - 1_000);
		flushSync();

		expect(overlay()).toBeNull();
	});

	it('dismisses on tap without clicking the card underneath', async () => {
		await mountLive([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		flushSync();

		const event = new Event('pointerdown', { bubbles: true, cancelable: true });
		overlay()!.dispatchEvent(event);
		card.click();

		expect(event.defaultPrevented).toBe(true);
		expect(onCardClick).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1_000);
		flushSync();
		expect(gone()).toBe(true);
	});

	it('lets later clicks through once the swallowed click has passed', async () => {
		await mountLive([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		flushSync();

		tap(overlay()!);
		card.click();
		card.click();

		expect(onCardClick).toHaveBeenCalledTimes(1);
	});

	it('dismisses on a key press without swallowing the next click', async () => {
		await mountLive([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		flushSync();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }));
		card.click();

		expect(onCardClick).toHaveBeenCalledTimes(1);
	});

	it('shows again after another idle period once dismissed', async () => {
		await mountLive([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		tap(overlay()!);
		await vi.advanceTimersByTimeAsync(1_000);

		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		flushSync();

		expect(overlay()).not.toBeNull();
	});

	it('drops a slide whose image fails to load and hides when none are left', async () => {
		await mountLive([slide('a')]);
		await vi.advanceTimersByTimeAsync(KIOSK_BANNER_IDLE_MS);
		flushSync();

		document.querySelector('img')!.dispatchEvent(new Event('error'));
		await vi.advanceTimersByTimeAsync(1_000);
		flushSync();

		expect(gone()).toBe(true);
	});

	it('stops all timers when unmounted', async () => {
		await mountLive([slide('a')]);

		unmount(instance!);
		instance = null;

		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('KioskBannerAttract preview (DOM)', () => {
	function mountPreview(banners: KioskBannerSlide[], onDismiss?: () => void) {
		instance = mount(KioskBannerAttract, {
			target: document.body,
			props: { mode: 'preview', banners, onDismiss }
		});
		flushSync();
	}

	it('shows at once, with no idle or refresh timer for a single slide', () => {
		mountPreview([slide('a')]);

		expect(overlay()).not.toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		expect(fetchKioskBanners).not.toHaveBeenCalled();
	});

	it('rotates through slides on their own duration', async () => {
		mountPreview([slide('a', { duration_sec: 5 }), slide('b')]);
		expect(document.querySelector('img')!.alt).toBe('Title a');

		await vi.advanceTimersByTimeAsync(5_000);
		flushSync();

		expect(document.querySelector('img')!.alt).toBe('Title b');
	});

	it('reports a dismiss to the caller', () => {
		const onDismiss = vi.fn();
		mountPreview([slide('a')], onDismiss);

		tap(overlay()!);

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
