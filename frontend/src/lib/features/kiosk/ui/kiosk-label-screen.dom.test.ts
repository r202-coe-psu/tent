// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import KioskLabelScreen from './kiosk-label-screen.svelte';

let instance: ReturnType<typeof mount> | null = null;
let ondone: ReturnType<typeof vi.fn>;

const render = (labels: string[]) => {
	instance = mount(KioskLabelScreen, { target: document.body, props: { labels, ondone } });
	flushSync();
};
const buttonByText = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === text
	);
const shownImage = () => document.querySelector<HTMLImageElement>('img')?.getAttribute('src');
const click = (button: HTMLButtonElement | undefined) => {
	button!.click();
	flushSync();
};

beforeEach(() => {
	languageStore.setLanguage('th');
	ondone = vi.fn();
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('KioskLabelScreen (DOM)', () => {
	it('shows one label at a time with a counter and steps through them with ก่อนหน้า / ถัดไป', () => {
		render(['AAA', 'BBB', 'CCC']);

		expect(shownImage()).toBe('data:image/png;base64,AAA');
		expect(document.body.textContent).toContain('1 / 3');
		expect(buttonByText('ก่อนหน้า')!.disabled).toBe(true);
		expect(buttonByText('ถัดไป')!.disabled).toBe(false);

		click(buttonByText('ถัดไป'));
		expect(shownImage()).toBe('data:image/png;base64,BBB');
		expect(document.body.textContent).toContain('2 / 3');

		click(buttonByText('ถัดไป'));
		expect(shownImage()).toBe('data:image/png;base64,CCC');
		expect(buttonByText('ถัดไป')!.disabled).toBe(true);

		click(buttonByText('ก่อนหน้า'));
		expect(shownImage()).toBe('data:image/png;base64,BBB');
		expect(document.body.textContent).toContain('2 / 3');
	});

	it('shows a single label without ก่อนหน้า / ถัดไป or a counter', () => {
		render(['AAA']);

		expect(shownImage()).toBe('data:image/png;base64,AAA');
		expect(buttonByText('ก่อนหน้า')).toBeUndefined();
		expect(buttonByText('ถัดไป')).toBeUndefined();
		expect(document.body.textContent).not.toContain('1 / 1');
	});

	it('calls ondone when เสร็จสิ้น is pressed', () => {
		render(['AAA', 'BBB']);

		click(buttonByText('เสร็จสิ้น'));

		expect(ondone).toHaveBeenCalledTimes(1);
	});

	it('calls ondone after 120 s without activity, and a button press restarts that wait', () => {
		vi.useFakeTimers();
		render(['AAA', 'BBB']);

		vi.advanceTimersByTime(119_000);
		click(buttonByText('ถัดไป'));
		vi.advanceTimersByTime(119_000);
		expect(ondone).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1_000);
		expect(ondone).toHaveBeenCalledTimes(1);
	});

	it('tells the visitor in Thai to photograph the QR and show it to staff', () => {
		render(['AAA', 'BBB']);

		expect(document.body.textContent).toContain('ถ่ายรูป QR นี้เก็บไว้ แล้วแสดงให้เจ้าหน้าที่สแกน');
	});

	it('shows the English copy when the kiosk language is English', () => {
		languageStore.setLanguage('en');
		render(['AAA', 'BBB']);

		expect(document.body.textContent).toContain(
			'Take a photo of this QR code and show it to staff to scan.'
		);
		expect(buttonByText('Previous')).toBeDefined();
		expect(buttonByText('Next')).toBeDefined();
		expect(buttonByText('Done')).toBeDefined();
		expect(document.querySelector('img')?.getAttribute('alt')).toBe('QR 1 / 2');
	});
});
