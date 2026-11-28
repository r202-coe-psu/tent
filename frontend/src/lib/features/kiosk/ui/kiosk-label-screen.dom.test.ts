// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { languageStore } from '$lib/stores/language.svelte';
import KioskLabelScreen from './kiosk-label-screen.svelte';

let instance: ReturnType<typeof mount> | null = null;
let ondone: Mock<() => void>;

const render = (labels: string[], notice?: string) => {
	instance = mount(KioskLabelScreen, {
		target: document.body,
		props: { labels, ondone, notice }
	});
	flushSync();
};
const renderReplaceable = (labels: string[]) => {
	const props = new SvelteMap([['labels', labels]]);
	instance = mount(KioskLabelScreen, {
		target: document.body,
		props: {
			get labels() {
				return props.get('labels')!;
			},
			ondone
		}
	});
	flushSync();
	return (next: string[]) => {
		props.set('labels', next);
		flushSync();
	};
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
		expect(document.querySelector('img')?.getAttribute('alt')).toBe('QR for person 1 of 2');
	});

	it('shows the last available label when the labels shrink while the last one was on screen', () => {
		const replaceLabels = renderReplaceable(['AAA', 'BBB', 'CCC']);
		click(buttonByText('ถัดไป'));
		click(buttonByText('ถัดไป'));

		replaceLabels(['AAA', 'BBB']);

		expect(shownImage()).toBe('data:image/png;base64,BBB');
		expect(document.body.textContent).toContain('2 / 2');
		expect(buttonByText('ถัดไป')!.disabled).toBe(true);
	});

	it('shows no image when there are no labels but still lets the visitor finish', () => {
		render([]);

		expect(document.querySelector('img')).toBeNull();
		click(buttonByText('เสร็จสิ้น'));
		expect(ondone).toHaveBeenCalledTimes(1);
	});

	it('describes each label to screen readers by person in Thai', () => {
		render(['AAA', 'BBB']);

		expect(document.querySelector('img')?.getAttribute('alt')).toBe('QR ของคนที่ 1 จาก 2');
	});

	it('announces the whole counter, not just the changed digit, when stepping', () => {
		render(['AAA', 'BBB']);

		const counter = [...document.querySelectorAll('p')].find((p) =>
			p.textContent?.includes('1 / 2')
		);
		expect(counter?.getAttribute('aria-live')).toBe('polite');
		expect(counter?.getAttribute('aria-atomic')).toBe('true');
	});

	it('moves focus to the screen on mount, labelled by the hint, so keyboard and reader users start here', () => {
		render(['AAA', 'BBB']);

		const screen = document.querySelector('[data-testid="kiosk-label-screen"]');
		expect(document.activeElement).toBe(screen);
		expect(screen?.getAttribute('aria-label')).toBe(
			'ถ่ายรูป QR นี้เก็บไว้ แล้วแสดงให้เจ้าหน้าที่สแกน'
		);
	});

	it('moves focus to ก่อนหน้า when ถัดไป disables itself on the last label, and back to ถัดไป on the first', () => {
		render(['AAA', 'BBB']);

		buttonByText('ถัดไป')!.focus();
		click(buttonByText('ถัดไป'));
		expect(document.activeElement).toBe(buttonByText('ก่อนหน้า'));

		click(buttonByText('ก่อนหน้า'));
		expect(document.activeElement).toBe(buttonByText('ถัดไป'));
	});

	it('treats any touch on the screen as activity and restarts the 120 s wait', () => {
		vi.useFakeTimers();
		render(['AAA', 'BBB']);

		vi.advanceTimersByTime(100_000);
		document
			.querySelector('img')!
			.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
		vi.advanceTimersByTime(119_000);
		expect(ondone).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1_000);
		expect(ondone).toHaveBeenCalledTimes(1);
	});

	it('shows the flow notice as a status above the image', () => {
		render(['AAA', 'BBB'], 'ออก QR ไม่ได้ 1 คน');

		const status = document.querySelector('[role="status"]');
		expect(status?.textContent?.trim()).toBe('ออก QR ไม่ได้ 1 คน');
		expect(
			status!.compareDocumentPosition(document.querySelector('img')!) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('shows no status when the flow gives no notice', () => {
		render(['AAA', 'BBB']);

		expect(document.querySelector('[role="status"]')).toBeNull();
	});
});
