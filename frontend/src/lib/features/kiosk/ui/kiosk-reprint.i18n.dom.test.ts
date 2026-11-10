// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import {
	KioskRequestError,
	type KioskEvacueeSummary,
	type KioskLookupResponse,
	type KioskReprintResult
} from '../data/kiosk-check-in.api';
import type { ReprintSessionDeps } from '../application/reprint-session.svelte';
import KioskReprint from './kiosk-reprint.svelte';

const THAI = /[฀-๿]/;

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

function member(
	id: string,
	status: string,
	selectable: boolean,
	age: number | null
): KioskEvacueeSummary {
	return {
		evacuee_id: id,
		first_name: `Name${id}`,
		last_name: 'S***',
		gender: null,
		age,
		status,
		is_primary: false,
		selectable
	};
}

const HOUSEHOLD: KioskLookupResponse = {
	kind: 'household',
	name_masked: true,
	shelter_code: 'SH001',
	primary_evacuee_id: 'EV1',
	members: [
		member('EV1', 'active', true, 40),
		member('EV2', 'arriving', true, null),
		member('EV3', 'pre_registered', false, 7)
	]
};

const REPRINT_RESULT: KioskReprintResult = {
	shelter_code: 'SH001',
	members: [
		{
			evacuee_id: 'EV1',
			qr_payload: 'qr-1',
			label: { name: 'สมชาย ใจดี', phone: null, zone: null, stations_passed: 1 }
		}
	]
};

let instance: ReturnType<typeof mount> | null = null;
let clock = 0;

function mountReprint(deps: Partial<ReprintSessionDeps>) {
	instance = mount(KioskReprint, {
		target: document.body,
		props: { contextQuery: '', deps }
	});
	flushSync();
}

/** What the visitor reads: the printout sheet (always Thai, only for the printer) is left out. */
const screenText = () => {
	const copy = document.body.cloneNode(true) as HTMLElement;
	copy.querySelectorAll('.kiosk-print-area').forEach((sheet) => sheet.remove());
	return copy.textContent?.replace(/\s+/g, ' ') ?? '';
};

const buttonWith = (text: string) =>
	[...document.querySelectorAll('button')].find((button) => button.textContent?.includes(text))!;

async function tapDigits(digits: string) {
	for (const digit of digits) {
		document.querySelector<HTMLButtonElement>(`button[aria-label$="${digit}"]`)!.click();
		flushSync();
	}
}

async function toMembers(searchLabel: string, expected: string) {
	await tapDigits('0812345678');
	buttonWith(searchLabel).click();
	await vi.waitFor(() => expect(screenText()).toContain(expected));
}

beforeEach(() => {
	vi.clearAllMocks();
	languageStore.setLanguage('th');
	clock = 0;
	vi.spyOn(Date, 'now').mockImplementation(() => (clock += 200));
	// happy-dom has no Web Animations: svelte's fade/scale transitions need a finishing stand-in.
	Element.prototype.animate = vi.fn(() => {
		const animation = {
			cancel() {},
			finish() {},
			pause() {},
			play() {},
			currentTime: 0,
			finished: Promise.resolve(),
			set onfinish(done: () => void) {
				queueMicrotask(done);
			}
		};
		return animation;
	}) as never;
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	languageStore.setLanguage('th');
});

describe('KioskReprint language', () => {
	it('walks phone, members and verify in English with no Thai', async () => {
		languageStore.setLanguage('en');
		mountReprint({
			lookup: vi.fn().mockResolvedValue(HOUSEHOLD),
			reprint: vi
				.fn()
				.mockRejectedValue(new KioskRequestError('x', 403, 'KIOSK_REPRINT_VERIFY_FAILED'))
		});
		expect(screenText()).toContain('Enter the phone number you registered with');
		expect(screenText()).toContain(
			'Not registered yet? Use your ID card QR or ThaiD on the home page'
		);

		await toMembers('Search', 'Choose members to print a QR for');
		expect(screenText()).toContain('Names are partly hidden for privacy');
		expect(screenText()).toContain('40 yrs ·Staying at the shelter');
		expect(screenText()).toContain('Age not given ·Checked in · awaiting screening');
		expect(screenText()).toContain('Not registered yet — use your ID card or ThaiD');
		expect(screenText()).toContain('Select all');
		expect(screenText()).not.toMatch(THAI);

		document.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click();
		await vi.waitFor(() => expect(screenText()).toContain('Next · 1 person'));
		buttonWith('Next').click();
		await vi.waitFor(() =>
			expect(screenText()).toContain("Enter the last 4 digits of the phone owner's ID number")
		);
		expect(screenText()).toContain('Confirm and print');
		expect(screenText()).toContain('Staff: confirm with PIN');
		expect(document.querySelector('output[aria-label="0 of 4 digits entered"]')).not.toBeNull();

		await tapDigits('9999');
		buttonWith('Confirm and print').click();
		await vi.waitFor(() => expect(screenText()).toContain('The last 4 digits are not correct'));
		expect(screenText()).not.toMatch(THAI);
	});

	it('walks phone, members and verify byte-identical in Thai', async () => {
		mountReprint({
			lookup: vi.fn().mockResolvedValue(HOUSEHOLD),
			reprint: vi
				.fn()
				.mockRejectedValue(new KioskRequestError('x', 403, 'KIOSK_REPRINT_VERIFY_FAILED'))
		});
		expect(screenText()).toContain('กรอกเบอร์โทรที่ลงทะเบียนไว้');
		expect(screenText()).toContain('ยังไม่เคยลงทะเบียน? ใช้ QR บัตรประชาชน หรือ ThaiD ที่หน้าแรก');

		await toMembers('ค้นหา', 'เลือกสมาชิกที่ต้องการพิมพ์ QR');
		expect(screenText()).toContain('ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว');
		expect(screenText()).toContain('40 ปี ·เข้าพักแล้ว');
		expect(screenText()).toContain('ไม่ระบุอายุ ·รายงานตัวแล้ว · รอคัดกรอง');
		expect(screenText()).toContain('ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD');
		expect(screenText()).toContain('เลือกทั้งหมด');

		document.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click();
		await vi.waitFor(() => expect(screenText()).toContain('ต่อไป · 1 คน'));
		buttonWith('ต่อไป').click();
		await vi.waitFor(() =>
			expect(screenText()).toContain('กรอกเลขบัตรประชาชน 4 ตัวท้ายของเจ้าของเบอร์')
		);
		expect(screenText()).toContain('ยืนยันและพิมพ์');
		expect(screenText()).toContain('ให้เจ้าหน้าที่ยืนยันด้วย PIN');
		expect(document.querySelector('output[aria-label="กรอกแล้ว 0 จาก 4 หลัก"]')).not.toBeNull();

		await tapDigits('9999');
		buttonWith('ยืนยันและพิมพ์').click();
		await vi.waitFor(() => expect(screenText()).toContain('เลข 4 ตัวท้ายไม่ถูกต้อง'));
	});

	it('tells the visitor in English when the labels are printed or printing failed', async () => {
		languageStore.setLanguage('en');
		const print = vi
			.fn<ReprintSessionDeps['print']>()
			.mockResolvedValueOnce({ kind: 'error', message: 'Printer is not ready' })
			.mockResolvedValueOnce({ kind: 'printed', printed: 1 });
		mountReprint({
			lookup: vi.fn().mockResolvedValue(HOUSEHOLD),
			reprint: vi.fn().mockResolvedValue(REPRINT_RESULT),
			print
		});
		await toMembers('Search', 'Choose members to print a QR for');
		document.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click();
		await vi.waitFor(() => expect(screenText()).toContain('Next · 1 person'));
		buttonWith('Next').click();
		await vi.waitFor(() => expect(screenText()).toContain('Confirm and print'));
		await tapDigits('1234');

		buttonWith('Confirm and print').click();
		await vi.waitFor(() => expect(screenText()).toContain('Printing failed'));
		expect(screenText()).toContain('Printer is not ready Press print again or contact staff.');
		expect(screenText()).not.toMatch(THAI);

		buttonWith('Print again').click();
		await vi.waitFor(() => expect(screenText()).toContain('QR printed'));
		expect(screenText()).toContain(
			'Take your 1 QR Code label at the print slot, then go to the screening point'
		);
		expect(screenText()).toContain('Back to home');
		expect(screenText()).not.toMatch(THAI);
	});

	it('tells the visitor byte-identical in Thai when the labels are printed or printing failed', async () => {
		const print = vi
			.fn<ReprintSessionDeps['print']>()
			.mockResolvedValueOnce({ kind: 'error', message: 'เครื่องพิมพ์ไม่พร้อม' })
			.mockResolvedValueOnce({ kind: 'printed', printed: 1 });
		mountReprint({
			lookup: vi.fn().mockResolvedValue(HOUSEHOLD),
			reprint: vi.fn().mockResolvedValue(REPRINT_RESULT),
			print
		});
		await toMembers('ค้นหา', 'เลือกสมาชิกที่ต้องการพิมพ์ QR');
		document.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click();
		await vi.waitFor(() => expect(screenText()).toContain('ต่อไป · 1 คน'));
		buttonWith('ต่อไป').click();
		await vi.waitFor(() => expect(screenText()).toContain('ยืนยันและพิมพ์'));
		await tapDigits('1234');

		buttonWith('ยืนยันและพิมพ์').click();
		await vi.waitFor(() => expect(screenText()).toContain('พิมพ์ไม่สำเร็จ'));
		expect(screenText()).toContain('เครื่องพิมพ์ไม่พร้อม กดพิมพ์อีกครั้ง หรือติดต่อเจ้าหน้าที่');

		buttonWith('พิมพ์อีกครั้ง').click();
		await vi.waitFor(() => expect(screenText()).toContain('พิมพ์ QR เรียบร้อย'));
		expect(screenText()).toContain('รับ QR Code 1 ดวงที่ช่องพิมพ์ แล้วไปที่จุดคัดกรอง');
		expect(screenText()).toContain('กลับหน้าแรก');
	});
});
