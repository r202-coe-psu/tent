// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
import {
	checkInSelectedMembers,
	lookupPreRegisteredEvacuee,
	type KioskLookupResponse
} from '../data/kiosk-check-in.api';

const THAI = /[฀-๿]/;

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../data/kiosk-check-in.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/kiosk-check-in.api')>()),
	lookupPreRegisteredEvacuee: vi.fn(),
	checkInSelectedMembers: vi.fn()
}));
vi.mock('../application/kiosk-label-print', () => ({
	prepareKioskQrImage: vi.fn().mockResolvedValue({ src: 'data:image/png;base64,AA==', sizeMm: 30 }),
	printKioskQrLabels: vi.fn().mockResolvedValue({ kind: 'printed', printed: 1 })
}));

const household = (shelterCode = 'SH001'): KioskLookupResponse => ({
	kind: 'household',
	name_masked: true,
	shelter_code: shelterCode,
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
		},
		{
			evacuee_id: 'p2',
			first_name: 'Malee',
			last_name: 'J***',
			gender: null,
			age: null,
			status: 'arriving',
			is_primary: false,
			selectable: false
		}
	]
});

let instance: ReturnType<typeof mount> | null = null;

function mountCheckIn(
	props: Partial<Parameters<typeof mount<typeof KioskPreRegisteredCheckIn>>[1]>
) {
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

/** What the visitor reads: the printout sheet (always Thai, shown only to the printer) is left out. */
const screenText = () => {
	const copy = document.body.cloneNode(true) as HTMLElement;
	copy.querySelectorAll('.kiosk-print-area').forEach((sheet) => sheet.remove());
	return copy.textContent?.replace(/\s+/g, ' ') ?? '';
};

beforeEach(() => {
	vi.clearAllMocks();
	languageStore.setLanguage('th');
	vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(household());
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	languageStore.setLanguage('th');
});

describe('KioskPreRegisteredCheckIn language', () => {
	it('lists the household to pick from in English', async () => {
		languageStore.setLanguage('en');

		mountCheckIn({});
		await vi.waitFor(() => expect(screenText()).toContain('Choose members'));

		expect(screenText()).toContain('Select who has arrived');
		expect(screenText()).toContain('Shelter SH001');
		expect(screenText()).toContain('Names are partly hidden for privacy');
		expect(screenText()).toContain('Registrant');
		expect(screenText()).toContain('35 yrs ·Pre-registered');
		expect(screenText()).toContain('Age not given ·Checked in · awaiting screening');
		expect(screenText()).toContain('Confirm · 1 person');
		expect(screenText()).toContain('Cancel');
		expect(screenText()).toContain('The QR holds no personal data');
		expect(screenText()).not.toMatch(THAI);
	});

	it('keeps the household list byte-identical in Thai', async () => {
		mountCheckIn({});
		await vi.waitFor(() => expect(screenText()).toContain('เลือกสมาชิก'));

		expect(screenText()).toContain('เลือกผู้ที่มาถึง');
		expect(screenText()).toContain('ศูนย์ SH001');
		expect(screenText()).toContain('ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว');
		expect(screenText()).toContain('ผู้ลงทะเบียน');
		expect(screenText()).toContain('35 ปี ·ลงทะเบียนล่วงหน้า');
		expect(screenText()).toContain('ไม่ระบุอายุ ·รายงานตัวแล้ว · รอคัดกรอง');
		expect(screenText()).toContain('ยืนยัน · 1 คน');
		expect(screenText()).toContain('QR ไม่มีข้อมูลส่วนบุคคล');
	});

	it('shows the check-in result in English after confirming', async () => {
		languageStore.setLanguage('en');
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
		mountCheckIn({});
		await vi.waitFor(() => expect(screenText()).toContain('Confirm · 1 person'));

		[...document.querySelectorAll('button')]
			.find((button) => button.textContent?.includes('Confirm'))!
			.click();
		await vi.waitFor(() => expect(screenText()).toContain('Check-in saved'));

		expect(screenText()).toContain('Check-in results');
		expect(screenText()).toContain('1 of 1 checked in · Shelter SH001');
		expect(screenText()).toContain('Print QR Code');
		expect(screenText()).toContain('Done');
		expect(screenText()).toContain('Checked in successfully · awaiting screening');
		expect(screenText()).not.toMatch(THAI);
	});

	it('shows the check-in result byte-identical in Thai after confirming', async () => {
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
		mountCheckIn({});
		await vi.waitFor(() => expect(screenText()).toContain('ยืนยัน · 1 คน'));

		[...document.querySelectorAll('button')]
			.find((button) => button.textContent?.includes('ยืนยัน'))!
			.click();
		await vi.waitFor(() => expect(screenText()).toContain('บันทึกผลรายงานตัวแล้ว'));

		expect(screenText()).toContain('ผลรายงานตัว');
		expect(screenText()).toContain('รายงานตัวแล้ว 1 จาก 1 คน · ศูนย์ SH001');
		expect(screenText()).toContain('พิมพ์ QR Code');
		expect(screenText()).toContain('เสร็จสิ้น');
		expect(screenText()).toContain('รายงานตัวสำเร็จ · รอคัดกรอง');
	});

	it('words a shelter mismatch in English', async () => {
		languageStore.setLanguage('en');
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(household('SH999'));

		mountCheckIn({});
		await vi.waitFor(() => expect(screenText()).toContain('Lookup failed'));

		expect(screenText()).toContain('The shelter on this kiosk does not match');
		expect(screenText()).not.toMatch(THAI);
	});

	it('words a shelter mismatch byte-identical in Thai', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(household('SH999'));

		mountCheckIn({});
		await vi.waitFor(() => expect(screenText()).toContain('ค้นหาไม่สำเร็จ'));

		expect(screenText()).toContain('ข้อมูลศูนย์ของเครื่องสแกนไม่ตรงกัน กรุณาติดต่อผู้ดูแลเครื่อง');
	});

	it('waits for the card in English', () => {
		languageStore.setLanguage('en');

		mountCheckIn({ input: null, cardMode: true });

		expect(screenText()).toContain('Waiting for card');
		expect(screenText()).toContain('Insert your card to search');
		expect(screenText()).not.toMatch(THAI);
	});
});
