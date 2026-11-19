// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ComponentProps } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import type { KioskEvacueeSummary } from '../data/kiosk-check-in.api';
import { checkOutKioskMembers } from '../data/kiosk-check-out.api';
import KioskSelfCheckout from './kiosk-self-checkout.svelte';

const THAI = /[฀-๿]/;

vi.mock('../data/kiosk-check-out.api', () => ({ checkOutKioskMembers: vi.fn() }));

function member(
	id: string,
	firstName: string,
	status: string,
	isPrimary = false
): KioskEvacueeSummary {
	return {
		evacuee_id: id,
		first_name: firstName,
		last_name: 'J***',
		gender: null,
		age: 30,
		status,
		is_primary: isPrimary,
		selectable: false
	};
}

const MEMBERS = [
	member('p1', 'Somchai', 'active', true),
	member('p2', 'Malee', 'room_confirmed'),
	member('p3', 'Manee', 'arriving')
];

let instance: ReturnType<typeof mount> | null = null;

function mountCheckout(props: Partial<ComponentProps<typeof KioskSelfCheckout>> = {}) {
	instance = mount(KioskSelfCheckout, {
		target: document.body,
		props: {
			gate: { source: 'smart-card', citizen_id: '1234567890123' },
			primaryEvacueeId: 'p1',
			members: MEMBERS,
			onnotme: () => {},
			ondone: () => {},
			...props
		}
	} as never);
	flushSync();
}

const screenText = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

function button(label: string): HTMLButtonElement {
	const found = [...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.includes(label)
	);
	if (!found) throw new Error(`no button "${label}" in: ${screenText()}`);
	return found;
}

function click(label: string) {
	button(label).click();
	flushSync();
}

const checkboxes = () => [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')];

beforeEach(() => {
	vi.clearAllMocks();
	languageStore.setLanguage('th');
	vi.mocked(checkOutKioskMembers).mockResolvedValue({
		shelter_code: 'SH001',
		members: [
			{ evacuee_id: 'p1', status: 'checked_out' },
			{ evacuee_id: 'p2', status: 'checked_out' }
		]
	});
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	languageStore.setLanguage('th');
});

describe('KioskSelfCheckout ask step', () => {
	it('asks whether to check out and offers check-out or "not me"', () => {
		mountCheckout();

		expect(screenText()).toContain('คุณเข้าพักในศูนย์แล้ว');
		expect(screenText()).toContain('ต้องการเช็คเอาต์ออกจากศูนย์ไหม');
		expect(button('เช็คเอาต์')).toBeTruthy();
		expect(button('ไม่ใช่ กลับ')).toBeTruthy();
		expect(checkboxes()).toHaveLength(0);
	});

	it('hands back to the caller on "not me" without calling the server', () => {
		const onnotme = vi.fn();
		mountCheckout({ onnotme });

		click('ไม่ใช่ กลับ');

		expect(onnotme).toHaveBeenCalledOnce();
		expect(checkOutKioskMembers).not.toHaveBeenCalled();
	});
});

describe('KioskSelfCheckout members step', () => {
	it('ticks the card holder, ticks nobody else, and greys out who cannot check out with the reason', () => {
		mountCheckout();
		click('เช็คเอาต์');

		expect(screenText()).toContain('เลือกผู้ที่จะเช็คเอาต์');
		expect(screenText()).toContain('Somchai');
		expect(screenText()).toContain('Manee');
		// Only the two who can check out have a checkbox; the arriving member has none.
		expect(checkboxes().map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'false']);
		expect(screenText()).toContain('ยังไม่ผ่านจุดจัดโซน — ติดต่อเจ้าหน้าที่');
	});

	it('disables "next" while nobody is ticked', () => {
		mountCheckout();
		click('เช็คเอาต์');
		expect(button('ถัดไป').disabled).toBe(false);

		checkboxes()[0].click();
		flushSync();

		expect(button('ถัดไป').disabled).toBe(true);
	});
});

describe('KioskSelfCheckout confirm and done', () => {
	function toConfirm(destination: string) {
		click('เช็คเอาต์');
		checkboxes()[1].click();
		flushSync();
		click('ถัดไป');
		click(destination);
	}

	it('lists who is checking out and where to before anything is sent', () => {
		mountCheckout();

		toConfirm('กลับบ้าน');

		expect(screenText()).toContain('ยืนยันเช็คเอาต์ 2 คน');
		expect(screenText()).toContain('Somchai');
		expect(screenText()).toContain('Malee');
		expect(screenText()).not.toContain('Manee');
		expect(screenText()).toContain('ปลายทาง');
		expect(checkOutKioskMembers).not.toHaveBeenCalled();
	});

	it('sends the check-out on confirm and shows who is done and who needs staff', async () => {
		vi.mocked(checkOutKioskMembers).mockResolvedValue({
			shelter_code: 'SH001',
			members: [
				{ evacuee_id: 'p1', status: 'checked_out' },
				{ evacuee_id: 'p2', status: 'not_eligible', stay_status: 'checked_out' }
			]
		});
		mountCheckout();
		toConfirm('อื่นๆ');

		click('ยืนยัน');
		await vi.waitFor(() => expect(screenText()).toContain('เช็คเอาต์ได้บางส่วน'));

		expect(checkOutKioskMembers).toHaveBeenCalledExactlyOnceWith({
			primary_evacuee_id: 'p1',
			evacuee_ids: ['p1', 'p2'],
			destination_type: 'other',
			gate: { source: 'smart-card', citizen_id: '1234567890123' }
		});
		expect(screenText()).toContain('เช็คเอาต์แล้ว');
		expect(screenText()).toContain('ติดต่อเจ้าหน้าที่');
		expect(screenText()).toContain('กลับหน้าแรกใน 15 วินาที');
	});

	it('reports busy while saving so the page stops its idle timeout, then not busy', async () => {
		const onbusychange = vi.fn();
		let release: () => void = () => {};
		vi.mocked(checkOutKioskMembers).mockReturnValue(
			new Promise((resolve) => {
				release = () => resolve({ shelter_code: 'SH001', members: [] });
			})
		);
		mountCheckout({ onbusychange });
		toConfirm('กลับบ้าน');

		click('ยืนยัน');
		expect(onbusychange).toHaveBeenLastCalledWith(true);
		release();
		await vi.waitFor(() => expect(onbusychange).toHaveBeenLastCalledWith(false));
	});

	it('shows the failure inline on the confirm step and lets the visitor try again', async () => {
		vi.mocked(checkOutKioskMembers).mockRejectedValueOnce(new TypeError('network'));
		mountCheckout();
		toConfirm('กลับบ้าน');

		click('ยืนยัน');
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toContain(
				'บันทึกการเช็คเอาต์ไม่สำเร็จ'
			)
		);

		expect(screenText()).toContain('ยืนยันเช็คเอาต์ 2 คน');
		expect(button('ยืนยัน').disabled).toBe(false);
	});

	it('goes home from the done screen', async () => {
		const ondone = vi.fn();
		mountCheckout({ ondone });
		toConfirm('กลับบ้าน');
		click('ยืนยัน');
		await vi.waitFor(() => expect(screenText()).toContain('เช็คเอาต์เรียบร้อยแล้ว'));

		click('กลับหน้าแรก');

		expect(ondone).toHaveBeenCalledOnce();
	});
});

describe('KioskSelfCheckout language', () => {
	it('shows the whole flow in English with no Thai on screen', async () => {
		languageStore.setLanguage('en');
		mountCheckout();
		expect(screenText()).toContain('Do you want to check out of the shelter?');
		expect(screenText()).not.toMatch(THAI);

		click('Check out');
		expect(screenText()).toContain('Choose who is checking out');
		expect(screenText()).toContain('Not zoned yet — please contact staff');
		expect(screenText()).toContain('Card holder');
		expect(screenText()).not.toMatch(THAI);

		click('Next');
		expect(screenText()).toContain('Where are you going?');
		click('Going home');
		expect(screenText()).toContain('Confirm checking out 1 person');
		expect(screenText()).not.toMatch(THAI);

		click('Confirm');
		await vi.waitFor(() => expect(screenText()).toContain('Check-out complete'));
		expect(screenText()).toContain('Back to home in 15 seconds');
	});
});
