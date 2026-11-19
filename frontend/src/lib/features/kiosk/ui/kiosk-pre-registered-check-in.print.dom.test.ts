// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ComponentProps } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
import {
	checkInSelectedMembers,
	lookupPreRegisteredEvacuee,
	type KioskLookupResponse
} from '../data/kiosk-check-in.api';
import { prepareKioskQrImage, printKioskQrLabels } from '../application/kiosk-label-print';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../data/kiosk-check-in.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/kiosk-check-in.api')>()),
	lookupPreRegisteredEvacuee: vi.fn(),
	checkInSelectedMembers: vi.fn()
}));
vi.mock('../application/kiosk-label-print', () => ({
	prepareKioskQrImage: vi.fn(),
	printKioskQrLabels: vi.fn()
}));

const HOUSEHOLD: KioskLookupResponse = {
	kind: 'household',
	name_masked: true,
	shelter_code: 'SH001',
	primary_evacuee_id: 'p1',
	members: [
		{
			evacuee_id: 'p1',
			first_name: 'Somchai',
			last_name: 'J***',
			gender: null,
			age: 35,
			status: 'pre_registered',
			is_primary: true,
			selectable: true
		}
	]
};

let instance: ReturnType<typeof mount> | null = null;

function mountCheckIn(props: Partial<ComponentProps<typeof KioskPreRegisteredCheckIn>> = {}) {
	instance = mount(KioskPreRegisteredCheckIn, {
		target: document.body,
		props: {
			input: { source: 'qr', token: 'tok' },
			contextQuery: '',
			displayShelterCode: 'SH001',
			onreset: () => {},
			...props
		}
	} as never);
	flushSync();
}

const screenText = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const buttonWith = (text: string) =>
	[...document.querySelectorAll('button')].find((button) => button.textContent?.includes(text))!;
const shownImage = () =>
	document
		.querySelector<HTMLImageElement>('[data-testid="kiosk-label-screen"] img')
		?.getAttribute('src');

/** Confirm the check-in, then press print: the result a print attempt ends with is the test's. */
async function checkInAndPrint(printResult: Awaited<ReturnType<typeof printKioskQrLabels>>) {
	vi.mocked(printKioskQrLabels).mockResolvedValue(printResult);
	mountCheckIn(mounted.props);
	await vi.waitFor(() => expect(screenText()).toContain('ยืนยัน · 1 คน'));
	buttonWith('ยืนยัน').click();
	await vi.waitFor(() => expect(screenText()).toContain('บันทึกผลรายงานตัวแล้ว'));
	buttonWith('พิมพ์ QR Code').click();
}

const mounted: { props: Partial<ComponentProps<typeof KioskPreRegisteredCheckIn>> } = { props: {} };

beforeEach(() => {
	vi.clearAllMocks();
	mounted.props = {};
	languageStore.setLanguage('th');
	vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(HOUSEHOLD);
	vi.mocked(prepareKioskQrImage).mockResolvedValue({
		src: 'data:image/png;base64,AA==',
		sizeMm: 30
	});
	vi.mocked(checkInSelectedMembers).mockResolvedValue({
		shelter_code: 'SH001',
		members: [
			{
				evacuee_id: 'p1',
				status: 'checked_in',
				qr_payload: 'QR1',
				label: { name: 'Somchai J', phone: null }
			}
		],
		retryable_evacuee_ids: []
	});
	// happy-dom has no Web Animations: svelte's fade/scale transitions need a finishing stand-in.
	Element.prototype.animate = vi.fn(() => ({
		cancel() {},
		finish() {},
		pause() {},
		play() {},
		currentTime: 0,
		finished: Promise.resolve(),
		set onfinish(done: () => void) {
			queueMicrotask(done);
		}
	})) as never;
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	languageStore.setLanguage('th');
});

describe('KioskPreRegisteredCheckIn labels on screen', () => {
	it('shows the labels on screen, not the print done notice, when the kiosk has no printer', async () => {
		await checkInAndPrint({ kind: 'screen', labels: ['AAA'] });

		await vi.waitFor(() => expect(shownImage()).toBe('data:image/png;base64,AAA'));
		expect(screenText()).not.toContain('พิมพ์เสร็จแล้ว');
	});

	it('offers the labels that did not print on screen, keeping the print error and the saved check-in', async () => {
		await checkInAndPrint({ kind: 'error', message: 'เครื่องพิมพ์ไม่พร้อม', labels: ['BBB'] });
		await vi.waitFor(() => expect(screenText()).toContain('เครื่องพิมพ์ไม่พร้อม'));
		expect(screenText()).toContain('บันทึกผลรายงานตัวแล้ว');

		buttonWith('แสดง QR บนจอแทน').click();

		await vi.waitFor(() => expect(shownImage()).toBe('data:image/png;base64,BBB'));
		expect(checkInSelectedMembers).toHaveBeenCalledTimes(1);
	});

	it('keeps the page reported busy while the labels are on screen and ends the visit when done', async () => {
		const onprintbusychange = vi.fn();
		const onreset = vi.fn();
		mounted.props = { onprintbusychange, onreset };
		await checkInAndPrint({ kind: 'screen', labels: ['AAA'] });
		await vi.waitFor(() => expect(shownImage()).toBe('data:image/png;base64,AAA'));

		expect(onprintbusychange).toHaveBeenLastCalledWith(true);
		expect(onreset).not.toHaveBeenCalled();

		buttonWith('เสร็จสิ้น').click();
		flushSync();

		expect(onprintbusychange).toHaveBeenLastCalledWith(false);
		expect(onreset).toHaveBeenCalledTimes(1);
	});

	it('keeps the page busy after the visitor opens the failed labels on screen', async () => {
		const onprintbusychange = vi.fn();
		mounted.props = { onprintbusychange };
		await checkInAndPrint({ kind: 'error', message: 'เครื่องพิมพ์ไม่พร้อม', labels: ['BBB'] });
		await vi.waitFor(() => expect(screenText()).toContain('เครื่องพิมพ์ไม่พร้อม'));
		expect(onprintbusychange).toHaveBeenLastCalledWith(false);

		buttonWith('แสดง QR บนจอแทน').click();
		await vi.waitFor(() => expect(shownImage()).toBe('data:image/png;base64,BBB'));

		expect(onprintbusychange).toHaveBeenLastCalledWith(true);
	});

	it('does not offer the on-screen choice when no label is left to show', async () => {
		await checkInAndPrint({ kind: 'error', message: 'เครื่องพิมพ์ไม่พร้อม' });
		await vi.waitFor(() => expect(screenText()).toContain('เครื่องพิมพ์ไม่พร้อม'));

		expect(
			[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('แสดง QR'))
		).toBe(false);
	});

	it('words the on-screen choice in English', async () => {
		languageStore.setLanguage('en');
		vi.mocked(printKioskQrLabels).mockResolvedValue({
			kind: 'error',
			message: 'Printer is not ready',
			labels: ['BBB']
		});
		mountCheckIn();
		await vi.waitFor(() => expect(screenText()).toContain('Confirm · 1 person'));
		buttonWith('Confirm').click();
		await vi.waitFor(() => expect(screenText()).toContain('Check-in saved'));
		buttonWith('Print QR Code').click();
		await vi.waitFor(() => expect(screenText()).toContain('Printer is not ready'));

		expect(buttonWith('Show the QR on screen instead')).toBeDefined();
	});
});
