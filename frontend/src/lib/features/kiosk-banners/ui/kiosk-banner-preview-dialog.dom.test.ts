// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { KioskBannerSlide } from '$lib/features/kiosk';
import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import KioskBannerPreviewDialog from './kiosk-banner-preview-dialog.svelte';

const slide = (id: string): KioskBannerSlide => ({
	id,
	title: `Title ${id}`,
	caption: null,
	duration_sec: 10,
	image_url: `/img/${id}`
});

type Props = {
	slides: Record<KioskScreenType, KioskBannerSlide[]>;
	screens?: readonly KioskScreenType[];
	initialScreen?: KioskScreenType;
	emptyMessage?: string;
};

let instance: ReturnType<typeof mount> | null = null;

function render(props: Props) {
	instance = mount(KioskBannerPreviewDialog, {
		target: document.body,
		props: { open: true, ...props }
	});
	flushSync();
}

const toggles = () => [
	...document.body.querySelectorAll<HTMLButtonElement>('[role="group"] button')
];
const toggle = (text: string) => toggles().find((b) => b.textContent?.includes(text));
const playing = () =>
	[
		...document.body.querySelectorAll<HTMLImageElement>('[data-testid="kiosk-banner-attract"] img')
	].map((img) => img.getAttribute('alt'));

const both = { compact: [slide('c1'), slide('c2')], portrait: [slide('p1')] };

beforeEach(() => {
	// happy-dom has no layout: give the preview area a width so the viewport renders.
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
		configurable: true,
		get: () => 800
	});
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
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

describe('KioskBannerPreviewDialog', () => {
	it('labels each screen toggle with its size and slide count', () => {
		render({ slides: both });
		expect(toggles().map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'ตู้เล็ก 1024×600 (2)',
			'ตู้ใหญ่ 1080×1920 (1)'
		]);
	});

	it('starts on the first screen that has slides and plays only that screen', () => {
		render({ slides: { compact: [], portrait: [slide('p1')] } });
		expect(toggle('ตู้ใหญ่')?.getAttribute('aria-pressed')).toBe('true');
		expect(playing()).toEqual(['Title p1']);
	});

	it('honours initialScreen', () => {
		render({ slides: both, initialScreen: 'portrait' });
		expect(toggle('ตู้ใหญ่')?.getAttribute('aria-pressed')).toBe('true');
		expect(playing()).toEqual(['Title p1']);
	});

	it('switching to ตู้ใหญ่ plays only the portrait slides', () => {
		render({ slides: both });
		expect(playing()).toEqual(['Title c1']);

		toggle('ตู้ใหญ่')?.click();
		flushSync();

		expect(toggle('ตู้ใหญ่')?.getAttribute('aria-pressed')).toBe('true');
		expect(toggle('ตู้เล็ก')?.getAttribute('aria-pressed')).toBe('false');
		expect(playing()).toEqual(['Title p1']);
	});

	it('shows the per-screen empty message when that screen has no slides', () => {
		render({ slides: { compact: [slide('c1')], portrait: [] } });
		toggle('ตู้ใหญ่')?.click();
		flushSync();

		expect(document.body.textContent).toContain('ไม่มีแบนเนอร์ตู้ใหญ่ที่แสดงอยู่ในขณะนี้');
		expect(playing()).toEqual([]);
	});

	it('single-screen mode has a heading instead of a toggle and uses the message override', () => {
		render({
			slides: { compact: [], portrait: [] },
			screens: ['portrait'],
			emptyMessage: 'เลือกรูปก่อนจึงจะดูตัวอย่างได้'
		});

		expect(toggles()).toEqual([]);
		expect(document.body.textContent).toContain('ตู้ใหญ่ 1080×1920');
		expect(document.body.textContent).toContain('เลือกรูปก่อนจึงจะดูตัวอย่างได้');
	});
});
