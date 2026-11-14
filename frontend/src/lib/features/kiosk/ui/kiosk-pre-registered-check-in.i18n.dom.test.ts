// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import type { ComponentProps } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
import {
	checkInSelectedMembers,
	lookupPreRegisteredEvacuee,
	type KioskEvacueeSummary,
	type KioskLookupResponse
} from '../data/kiosk-check-in.api';
import { checkOutKioskMembers } from '../data/kiosk-check-out.api';

const THAI = /[฀-๿]/;

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../data/kiosk-check-in.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/kiosk-check-in.api')>()),
	lookupPreRegisteredEvacuee: vi.fn(),
	checkInSelectedMembers: vi.fn()
}));
vi.mock('../data/kiosk-check-out.api', () => ({ checkOutKioskMembers: vi.fn() }));
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

function mountCheckIn(props: Partial<ComponentProps<typeof KioskPreRegisteredCheckIn>>) {
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

describe('KioskPreRegisteredCheckIn self-checkout (#1401)', () => {
	const CARD = { source: 'smart-card', citizen_id: '1234567890123' } as const;
	/** Stands in for the face-check camera the card page passes as `hold`. */
	const faceCheck = createRawSnippet(() => ({
		render: () => '<div data-testid="face-check-hold">camera</div>'
	}));
	const faceCheckShown = () => document.querySelector('[data-testid="face-check-hold"]') !== null;

	function person(
		id: string,
		status: string,
		options: { primary?: boolean; selectable?: boolean } = {}
	): KioskEvacueeSummary {
		return {
			evacuee_id: id,
			first_name: id === 'p1' ? 'Somchai' : 'Malee',
			last_name: 'J***',
			gender: null,
			age: 35,
			status,
			is_primary: options.primary ?? false,
			selectable: options.selectable ?? false
		};
	}

	function lookupOf(...members: KioskEvacueeSummary[]): KioskLookupResponse {
		return {
			kind: 'household',
			name_masked: true,
			shelter_code: 'SH001',
			primary_evacuee_id: 'p1',
			members
		};
	}

	/** A card visitor on a kiosk with the face check on: the face step is held in front of the list. */
	const mountCard = (props: Partial<ComponentProps<typeof KioskPreRegisteredCheckIn>> = {}) =>
		mountCheckIn({ input: CARD, cardMode: true, holdMembers: true, hold: faceCheck, ...props });

	function click(label: string) {
		[...document.querySelectorAll('button')]
			.find((button) => button.textContent?.includes(label))!
			.click();
		flushSync();
	}

	it('asks a card visitor who is already in the shelter whether to check out, with no face check', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(person('p1', 'active', { primary: true }))
		);

		mountCard();
		await vi.waitFor(() => expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว'));

		expect(screenText()).toContain('ไม่ใช่ กลับ');
		expect(faceCheckShown()).toBe(false);
		expect(screenText()).not.toContain('เลือกสมาชิก');
	});

	it('never mounts the face check through the whole check-out, and sends the check-out without it', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(person('p1', 'active', { primary: true }))
		);
		vi.mocked(checkOutKioskMembers).mockResolvedValue({
			shelter_code: 'SH001',
			members: [{ evacuee_id: 'p1', status: 'checked_out' }]
		});
		mountCard();
		await vi.waitFor(() => expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว'));
		const seen = [faceCheckShown()];

		click('เช็คเอาต์');
		seen.push(faceCheckShown());
		click('ถัดไป');
		seen.push(faceCheckShown());
		click('กลับบ้าน');
		seen.push(faceCheckShown());
		click('ยืนยัน');
		await vi.waitFor(() => expect(screenText()).toContain('เช็คเอาต์เรียบร้อยแล้ว'));
		seen.push(faceCheckShown());

		expect(seen).toEqual([false, false, false, false, false]);
		expect(checkOutKioskMembers).toHaveBeenCalledExactlyOnceWith({
			primary_evacuee_id: 'p1',
			evacuee_ids: ['p1'],
			destination_type: 'returned_home',
			gate: CARD
		});
	});

	it('offers the same check-out to a ThaiD visitor, sending the ThaiD session', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(person('p1', 'room_confirmed', { primary: true }))
		);
		vi.mocked(checkOutKioskMembers).mockResolvedValue({ shelter_code: 'SH001', members: [] });
		const thaid = { source: 'thaid', session_id: 'thaid-session-1' } as const;

		mountCheckIn({ input: thaid });
		await vi.waitFor(() => expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว'));
		click('เช็คเอาต์');
		click('ถัดไป');
		click('อื่นๆ');
		click('ยืนยัน');
		await vi.waitFor(() => expect(checkOutKioskMembers).toHaveBeenCalled());

		expect(vi.mocked(checkOutKioskMembers).mock.calls[0][0]).toMatchObject({
			destination_type: 'other',
			gate: thaid
		});
	});

	it('keeps the old behaviour for a QR visitor who is already in the shelter', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(person('p1', 'active', { primary: true }), person('p2', 'arriving'))
		);

		mountCheckIn({ input: { source: 'qr', token: 'tok' } });
		await vi.waitFor(() => expect(screenText()).toContain('พิมพ์ QR'));

		expect(screenText()).not.toContain('คุณเข้าพักในศูนย์แล้ว');
	});

	it('keeps the old behaviour for a card visitor who has not been zoned yet', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(person('p1', 'arriving', { primary: true }))
		);

		mountCard({ holdMembers: false });
		await vi.waitFor(() => expect(screenText()).toContain('พิมพ์ QR'));

		expect(screenText()).not.toContain('คุณเข้าพักในศูนย์แล้ว');
	});

	it('on "not me" with someone left to check in, goes to the usual check-in list and its face check', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(
				person('p1', 'active', { primary: true }),
				person('p2', 'pre_registered', { selectable: true })
			)
		);
		mountCard();
		await vi.waitFor(() => expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว'));
		expect(faceCheckShown()).toBe(false);

		click('ไม่ใช่ กลับ');

		expect(screenText()).not.toContain('คุณเข้าพักในศูนย์แล้ว');
		expect(faceCheckShown()).toBe(true);
		expect(checkOutKioskMembers).not.toHaveBeenCalled();
	});

	it('on "not me" without the face check, shows the usual member list to check in', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(
				person('p1', 'active', { primary: true }),
				person('p2', 'pre_registered', { selectable: true })
			)
		);
		mountCard({ holdMembers: false });
		await vi.waitFor(() => expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว'));

		click('ไม่ใช่ กลับ');

		expect(screenText()).toContain('เลือกผู้ที่มาถึง');
		expect(screenText()).toContain('Malee');
		expect(screenText()).toContain('ลงทะเบียนล่วงหน้า');
	});

	it('on "not me" with nobody left to check in, falls back to the usual reprint results', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(person('p1', 'active', { primary: true }), person('p2', 'arriving'))
		);
		mountCard({ holdMembers: false });
		await vi.waitFor(() => expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว'));

		click('ไม่ใช่ กลับ');

		await vi.waitFor(() => expect(screenText()).toContain('พิมพ์ QR'));
		expect(screenText()).not.toContain('คุณเข้าพักในศูนย์แล้ว');
	});

	it('pauses the page idle timeout while the check-out is being saved', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(
			lookupOf(person('p1', 'active', { primary: true }))
		);
		let release: () => void = () => {};
		vi.mocked(checkOutKioskMembers).mockReturnValue(
			new Promise((resolve) => {
				release = () => resolve({ shelter_code: 'SH001', members: [] });
			})
		);
		const onprintbusychange = vi.fn();
		mountCard({ onprintbusychange });
		await vi.waitFor(() => expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว'));
		click('เช็คเอาต์');
		click('ถัดไป');
		click('กลับบ้าน');

		click('ยืนยัน');
		expect(onprintbusychange).toHaveBeenLastCalledWith(true);
		release();
		await vi.waitFor(() => expect(onprintbusychange).toHaveBeenLastCalledWith(false));
	});
});
