// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { ComponentProps } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
import {
	checkInSelectedMembers,
	lookupPreRegisteredEvacuee,
	type GateInput,
	type KioskLookupResponse
} from '../data/kiosk-check-in.api';
import { prepareKioskQrImage, printKioskQrLabels } from '../application/kiosk-label-print';
import { loadKioskHardware } from '../application/kiosk-qr-input';
import { DEFAULT_KIOSK_HARDWARE } from '../domain/kiosk-hardware';

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
vi.mock('../application/kiosk-qr-input', () => ({ loadKioskHardware: vi.fn() }));

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

/** Mount with an input that can be swapped afterwards, as the card scanner does with the next card. */
function mountWithSwappableInput(first: GateInput) {
	const current = new SvelteMap<'input', GateInput>([['input', first]]);
	instance = mount(KioskPreRegisteredCheckIn, {
		target: document.body,
		props: {
			contextQuery: '',
			displayShelterCode: 'SH001',
			onreset: () => {},
			...mounted.props,
			get input() {
				return current.get('input') ?? null;
			}
		}
	} as never);
	flushSync();
	return (next: GateInput) => {
		current.set('input', next);
		flushSync();
	};
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
	vi.mocked(loadKioskHardware).mockResolvedValue(DEFAULT_KIOSK_HARDWARE);
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

	describe('when a new visitor starts a lookup', () => {
		const NEXT: KioskLookupResponse = {
			...HOUSEHOLD,
			primary_evacuee_id: 'p2',
			members: [{ ...HOUSEHOLD.members[0], evacuee_id: 'p2', first_name: 'Somying' }]
		};

		async function checkInThenScan(first: GateInput) {
			const scanNext = mountWithSwappableInput(first);
			await vi.waitFor(() => expect(screenText()).toContain('ยืนยัน · 1 คน'));
			buttonWith('ยืนยัน').click();
			await vi.waitFor(() => expect(screenText()).toContain('บันทึกผลรายงานตัวแล้ว'));
			buttonWith('พิมพ์ QR Code').click();
			return scanNext;
		}

		it('closes the previous visitor label screen, releases the busy report and lists the new members', async () => {
			const onprintbusychange = vi.fn();
			const onreset = vi.fn();
			mounted.props = { onprintbusychange, onreset };
			vi.mocked(printKioskQrLabels).mockResolvedValue({ kind: 'screen', labels: ['AAA'] });
			const scanNext = await checkInThenScan({ source: 'qr', token: 'a' });
			await vi.waitFor(() => expect(shownImage()).toBe('data:image/png;base64,AAA'));
			vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(NEXT);

			scanNext({ source: 'qr', token: 'b' });

			await vi.waitFor(() => expect(screenText()).toContain('Somying'));
			expect(shownImage()).toBeUndefined();
			expect(onprintbusychange).toHaveBeenLastCalledWith(false);
			expect(onreset).not.toHaveBeenCalled();
		});

		it('drops the previous visitor labels that did not print', async () => {
			mounted.props = {};
			vi.mocked(printKioskQrLabels).mockResolvedValue({
				kind: 'error',
				message: 'เครื่องพิมพ์ไม่พร้อม',
				labels: ['BBB']
			});
			const scanNext = await checkInThenScan({ source: 'qr', token: 'a' });
			await vi.waitFor(() => expect(screenText()).toContain('แสดง QR บนจอแทน'));
			vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(NEXT);
			vi.mocked(checkInSelectedMembers).mockResolvedValue({
				shelter_code: 'SH001',
				members: [{ evacuee_id: 'p2', status: 'checked_in', qr_payload: 'QR2', label: null }],
				retryable_evacuee_ids: []
			} as never);

			vi.mocked(prepareKioskQrImage).mockRejectedValue(new Error('render failed'));

			scanNext({ source: 'qr', token: 'b' });
			await vi.waitFor(() => expect(screenText()).toContain('Somying'));
			buttonWith('ยืนยัน').click();
			await vi.waitFor(() => expect(screenText()).toContain('บันทึกผลรายงานตัวแล้ว'));
			await vi.waitFor(() => expect(screenText()).toContain('ใช้ปุ่มพิมพ์อีกครั้ง'));

			expect(screenText()).not.toContain('แสดง QR บนจอแทน');
		});

		it('discards a print of the previous visitor that resolves after the new lookup started', async () => {
			const onprintbusychange = vi.fn();
			mounted.props = { onprintbusychange };
			let finishPrint: (result: Awaited<ReturnType<typeof printKioskQrLabels>>) => void = () => {};
			vi.mocked(printKioskQrLabels).mockReturnValue(
				new Promise((resolve) => {
					finishPrint = resolve;
				})
			);
			const scanNext = await checkInThenScan({ source: 'qr', token: 'a' });
			await vi.waitFor(() => expect(printKioskQrLabels).toHaveBeenCalledTimes(1));
			vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(NEXT);

			scanNext({ source: 'qr', token: 'b' });
			await vi.waitFor(() => expect(screenText()).toContain('Somying'));
			finishPrint({ kind: 'screen', labels: ['AAA'] });
			await vi.waitFor(() => expect(onprintbusychange).toHaveBeenLastCalledWith(false));
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(shownImage()).toBeUndefined();
			expect(screenText()).toContain('Somying');
			expect(onprintbusychange).toHaveBeenLastCalledWith(false);
		});

		it('drops the failed print of the previous visitor that resolves after the new lookup started', async () => {
			let finishPrint: (result: Awaited<ReturnType<typeof printKioskQrLabels>>) => void = () => {};
			vi.mocked(printKioskQrLabels).mockReturnValue(
				new Promise((resolve) => {
					finishPrint = resolve;
				})
			);
			const scanNext = await checkInThenScan({ source: 'qr', token: 'a' });
			await vi.waitFor(() => expect(printKioskQrLabels).toHaveBeenCalledTimes(1));
			vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(NEXT);
			vi.mocked(checkInSelectedMembers).mockResolvedValue({
				shelter_code: 'SH001',
				members: [{ evacuee_id: 'p2', status: 'checked_in', qr_payload: 'QR2', label: null }],
				retryable_evacuee_ids: []
			} as never);

			vi.mocked(prepareKioskQrImage).mockRejectedValue(new Error('render failed'));

			scanNext({ source: 'qr', token: 'b' });
			await vi.waitFor(() => expect(screenText()).toContain('Somying'));
			finishPrint({ kind: 'error', message: 'เครื่องพิมพ์ไม่พร้อม', labels: ['BBB'] });
			await new Promise((resolve) => setTimeout(resolve, 0));
			buttonWith('ยืนยัน').click();
			await vi.waitFor(() => expect(screenText()).toContain('ใช้ปุ่มพิมพ์อีกครั้ง'));

			expect(screenText()).not.toContain('เครื่องพิมพ์ไม่พร้อม');
			expect(screenText()).not.toContain('แสดง QR บนจอแทน');
		});
	});
});

describe('KioskPreRegisteredCheckIn on a kiosk without a printer', () => {
	const TWO_MEMBERS: KioskLookupResponse = {
		...HOUSEHOLD,
		members: [
			HOUSEHOLD.members[0],
			{ ...HOUSEHOLD.members[0], evacuee_id: 'p2', first_name: 'Somying', is_primary: false }
		]
	};

	beforeEach(() => {
		vi.mocked(loadKioskHardware).mockResolvedValue({ ...DEFAULT_KIOSK_HARDWARE, printer: 'none' });
	});

	async function confirmCheckIn(
		confirmLabel = 'ยืนยัน · 1 คน',
		savedText = 'บันทึกผลรายงานตัวแล้ว'
	) {
		mountCheckIn();
		await vi.waitFor(() => expect(screenText()).toContain('· 1'));
		if (confirmLabel.includes('2')) {
			buttonWith('เลือกทั้งหมด').click();
			flushSync();
		}
		await vi.waitFor(() => expect(screenText()).toContain(confirmLabel));
		buttonWith(confirmLabel.split(' ')[0]).click();
		await vi.waitFor(() => expect(screenText()).toContain(savedText));
	}

	it('words the results as showing the QR, not printing it', async () => {
		await confirmCheckIn();
		await vi.waitFor(() => expect(screenText()).toContain('ตรวจผล แล้วแสดง QR Code'));

		expect(buttonWith('แสดง QR Code')).toBeDefined();
		expect(screenText()).not.toContain('พิมพ์ QR Code');
	});

	it('words the results in English as showing the QR', async () => {
		languageStore.setLanguage('en');
		await confirmCheckIn('Confirm · 1 person', 'Check-in saved');
		await vi.waitFor(() =>
			expect(screenText()).toContain('Check the results, then show your QR Code')
		);

		expect(buttonWith('Show QR Code')).toBeDefined();
		expect(screenText()).not.toContain('Print QR Code');
	});

	it('words the reprint choice as showing the QR', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue({
			...HOUSEHOLD,
			members: [{ ...HOUSEHOLD.members[0], status: 'arriving', selectable: false }]
		});
		vi.mocked(checkInSelectedMembers).mockResolvedValue({
			shelter_code: 'SH001',
			members: [],
			retryable_evacuee_ids: []
		});
		mountCheckIn();
		await vi.waitFor(() => expect(screenText()).toContain('เลือกคนที่จะแสดง QR Code'));

		expect(screenText()).not.toContain('พิมพ์');
	});

	it('does not show the printing overlay before the label screen', async () => {
		let finishPrint: (result: Awaited<ReturnType<typeof printKioskQrLabels>>) => void = () => {};
		vi.mocked(printKioskQrLabels).mockReturnValue(
			new Promise((resolve) => {
				finishPrint = resolve;
			})
		);
		await confirmCheckIn();
		buttonWith('แสดง QR Code').click();
		await vi.waitFor(() => expect(printKioskQrLabels).toHaveBeenCalledTimes(1));

		expect(screenText()).not.toContain('กำลังพิมพ์');

		finishPrint({ kind: 'screen', labels: ['AAA'] });
		await vi.waitFor(() => expect(shownImage()).toBe('data:image/png;base64,AAA'));
	});

	it('hands the print flow the printer it already resolved instead of fetching again', async () => {
		vi.mocked(printKioskQrLabels).mockResolvedValue({ kind: 'screen', labels: ['AAA'] });
		await confirmCheckIn();
		buttonWith('แสดง QR Code').click();
		await vi.waitFor(() => expect(printKioskQrLabels).toHaveBeenCalledTimes(1));

		expect(vi.mocked(printKioskQrLabels).mock.calls[0][3]).toBe('none');
	});

	it('tells the visitor on the label screen when some members QR could not be issued', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(TWO_MEMBERS);
		vi.mocked(checkInSelectedMembers).mockResolvedValue({
			shelter_code: 'SH001',
			members: [
				{
					evacuee_id: 'p1',
					status: 'checked_in',
					qr_payload: 'QR1',
					label: { name: 'Somchai J', phone: null }
				},
				{ evacuee_id: 'p2', status: 'checked_in', qr_issue_failed: true, label: null }
			],
			retryable_evacuee_ids: []
		} as never);
		vi.mocked(printKioskQrLabels).mockResolvedValue({ kind: 'screen', labels: ['AAA'] });
		await confirmCheckIn('ยืนยัน · 2 คน');
		buttonWith('แสดง QR Code').click();
		await vi.waitFor(() => expect(shownImage()).toBe('data:image/png;base64,AAA'));

		expect(
			document.querySelector('[data-testid="kiosk-label-screen"] [role="status"]')?.textContent
		).toContain('ออก QR ไม่สำเร็จ 1 คน');
	});
});

describe('KioskPreRegisteredCheckIn on a kiosk with a printer', () => {
	it('hands the print flow the printer it already resolved instead of fetching again', async () => {
		await checkInAndPrint({ kind: 'printed', printed: 1 });
		await vi.waitFor(() => expect(printKioskQrLabels).toHaveBeenCalledTimes(1));

		expect(vi.mocked(printKioskQrLabels).mock.calls[0][3]).toBe('cups');
	});

	it('keeps the print wording on the results', async () => {
		mountCheckIn();
		await vi.waitFor(() => expect(screenText()).toContain('ยืนยัน · 1 คน'));
		buttonWith('ยืนยัน').click();
		await vi.waitFor(() => expect(screenText()).toContain('ตรวจผล แล้วพิมพ์ QR Code'));

		expect(buttonWith('พิมพ์ QR Code')).toBeDefined();
	});
});
