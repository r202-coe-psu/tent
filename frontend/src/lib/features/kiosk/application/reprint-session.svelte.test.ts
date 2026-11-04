import { describe, expect, it, vi, type Mock } from 'vitest';
import {
	KioskRequestError,
	type KioskEvacueeSummary,
	type KioskLookupResponse,
	type KioskReprintResult
} from '../data/kiosk-check-in.api';
import { ReprintSession, type ReprintSessionDeps } from './reprint-session.svelte';

type FakeDeps = { [K in keyof ReprintSessionDeps]: Mock<ReprintSessionDeps[K]> };

function member(
	id: string,
	status: string,
	selectable: boolean,
	isPrimary = false
): KioskEvacueeSummary {
	return {
		evacuee_id: id,
		first_name: `ชื่อ${id}`,
		last_name: 'ส****',
		gender: null,
		age: null,
		status,
		is_primary: isPrimary,
		selectable
	};
}

const HOUSEHOLD: KioskLookupResponse = {
	kind: 'household',
	name_masked: true,
	shelter_code: 'SH001',
	primary_evacuee_id: 'EV1',
	members: [
		member('EV1', 'active', true, true),
		member('EV2', 'arriving', true),
		member('EV3', 'pre_registered', false)
	]
};

const REPRINT_RESULT: KioskReprintResult = {
	shelter_code: 'SH001',
	members: [
		{
			evacuee_id: 'EV1',
			qr_payload: 'qr-1',
			label: { name: 'สมชาย ใจดี', phone: '0812345678', zone: null, stations_passed: 1 }
		},
		{
			evacuee_id: 'EV2',
			qr_payload: 'qr-2',
			label: { name: 'สมหญิง ใจดี', phone: '0812345678', zone: null, stations_passed: 1 }
		}
	]
};

function setup(overrides: Partial<FakeDeps> = {}) {
	const deps: FakeDeps = {
		lookup: vi.fn<ReprintSessionDeps['lookup']>().mockResolvedValue(HOUSEHOLD),
		reprint: vi.fn<ReprintSessionDeps['reprint']>().mockResolvedValue(REPRINT_RESULT),
		print: vi.fn<ReprintSessionDeps['print']>().mockResolvedValue({ kind: 'printed', printed: 2 }),
		...overrides
	};
	return { deps, session: new ReprintSession(deps) };
}

async function toVerify(session: ReprintSession) {
	session.phone = '0812345678';
	await session.submitPhone();
	session.toggleAll();
	session.continueToVerify();
}

describe('ReprintSession phone step', () => {
	it('starts on the phone step and rejects a phone that is not submittable', async () => {
		const { deps, session } = setup();
		expect(session.step).toBe('phone');

		session.phone = '081234';
		await session.submitPhone();

		expect(deps.lookup).not.toHaveBeenCalled();
		expect(session.step).toBe('phone');
	});

	it('looks the phone up with nobody ticked yet, so the visitor picks who to print', async () => {
		const { deps, session } = setup();
		session.phone = '0812345678';

		await session.submitPhone();

		expect(deps.lookup).toHaveBeenCalledWith({ source: 'phone', phone: '0812345678' });
		expect(session.step).toBe('members');
		expect(session.members.map((m) => m.evacuee_id)).toEqual(['EV1', 'EV2', 'EV3']);
		expect(session.selectedIds).toEqual([]);
		expect(session.canContinue).toBe(false);
		expect(session.blocked).toBe(false);
	});

	it('lets the visitor untick a member and needs at least one ticked to continue', async () => {
		const { session } = setup();
		session.phone = '0812345678';
		await session.submitPhone();
		session.toggleAll();

		session.toggleMember('EV2');
		expect(session.selectedIds).toEqual(['EV1']);
		session.toggleMember('EV1');
		expect(session.selectedIds).toEqual([]);
		expect(session.canContinue).toBe(false);
		session.continueToVerify();
		expect(session.step).toBe('members');

		// A member that is not selectable (pre-registered) can never be ticked.
		session.toggleMember('EV3');
		expect(session.selectedIds).toEqual([]);
	});

	it('toggles all selectable members at once', async () => {
		const { session } = setup();
		session.phone = '0812345678';
		await session.submitPhone();

		session.toggleAll();
		expect(session.selectedIds).toEqual(['EV1', 'EV2']);
		session.toggleAll();
		expect(session.selectedIds).toEqual([]);
	});

	it('blocks when nobody has been registered yet, with a way back', async () => {
		const lookup = vi.fn<ReprintSessionDeps['lookup']>().mockResolvedValue({
			...HOUSEHOLD,
			kind: 'household',
			members: [member('EV3', 'pre_registered', false, true)]
		} as KioskLookupResponse);
		const { session } = setup({ lookup });
		session.phone = '0812345678';

		await session.submitPhone();

		expect(session.step).toBe('members');
		expect(session.blocked).toBe(true);
		expect(session.selectedIds).toEqual([]);
		expect(session.canContinue).toBe(false);
		session.continueToVerify();
		expect(session.step).toBe('members');
		session.back();
		expect(session.step).toBe('phone');
	});

	it('explains a block with the pre-registered wording when everyone is pre-registered', async () => {
		const lookup = vi.fn<ReprintSessionDeps['lookup']>().mockResolvedValue({
			...HOUSEHOLD,
			members: [
				member('EV3', 'pre_registered', false, true),
				member('EV4', 'pre_registered', false)
			]
		} as KioskLookupResponse);
		const { session } = setup({ lookup });
		session.phone = '0812345678';
		await session.submitPhone();

		expect(session.blocked).toBe(true);
		expect(session.blockedReason).toBe('ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD');
	});

	it('blocks with the generic wording when someone is on temporary leave', async () => {
		const lookup = vi.fn<ReprintSessionDeps['lookup']>().mockResolvedValue({
			...HOUSEHOLD,
			members: [
				member('EV3', 'pre_registered', false, true),
				member('EV4', 'temporary_leave', false)
			]
		} as KioskLookupResponse);
		const { session } = setup({ lookup });
		session.phone = '0812345678';
		await session.submitPhone();

		expect(session.blocked).toBe(true);
		expect(session.blockedReason).toBe('ไม่มีผู้ที่พิมพ์ QR ได้ กรุณาติดต่อเจ้าหน้าที่');
	});

	it.each([
		['PRE_REGISTRATION_NOT_FOUND', 404, 'ไม่พบข้อมูลที่ลงทะเบียนด้วยเบอร์นี้'],
		['KIOSK_RATE_LIMITED', 429, 'ลองผิดหลายครั้ง กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่'],
		['KIOSK_TOO_MANY_MATCHES', 409, 'พบหลายรายการ กรุณาติดต่อเจ้าหน้าที่'],
		['KIOSK_METHOD_DISABLED', 403, 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่']
	])(
		'maps lookup error %s to a message and stays on the phone step',
		async (code, status, text) => {
			const lookup = vi
				.fn<ReprintSessionDeps['lookup']>()
				.mockRejectedValue(new KioskRequestError('server text', status, code));
			const { session } = setup({ lookup });
			session.phone = '0812345678';

			await session.submitPhone();

			expect(session.step).toBe('phone');
			expect(session.error).toBe(text);
			expect(session.busy).toBe(false);
		}
	);

	it('shows the server message for any other failure', async () => {
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockRejectedValue(new KioskRequestError('เชื่อมต่อช้า กรุณาลองอีกครั้ง', 0, 'TIMEOUT'));
		const { session } = setup({ lookup });
		session.phone = '0812345678';

		await session.submitPhone();

		expect(session.error).toBe('เชื่อมต่อช้า กรุณาลองอีกครั้ง');
	});

	it('treats a kiosk-registered answer as nothing found for this phone', async () => {
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockResolvedValue({ kind: 'kiosk_registered', shelter_code: 'SH001' });
		const { session } = setup({ lookup });
		session.phone = '0812345678';

		await session.submitPhone();

		expect(session.step).toBe('phone');
		expect(session.error).toBe('ไม่พบข้อมูลที่ลงทะเบียนด้วยเบอร์นี้');
	});
});

describe('ReprintSession candidates', () => {
	const CANDIDATES: KioskLookupResponse = {
		kind: 'candidates',
		shelter_code: 'SH001',
		candidates: [
			{
				primary_evacuee_id: 'EV1',
				contact_display: 'สมชาย ใ***',
				member_count: 3,
				pending_count: 2
			},
			{
				primary_evacuee_id: 'EV9',
				contact_display: 'สมศรี ข***',
				member_count: 1,
				pending_count: 1
			}
		]
	};

	it('shows the households, then looks the chosen one up and lands on members', async () => {
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockResolvedValueOnce(CANDIDATES)
			.mockResolvedValueOnce(HOUSEHOLD);
		const { deps, session } = setup({ lookup });
		session.phone = '0812345678';

		await session.submitPhone();
		expect(session.step).toBe('candidates');
		expect(session.candidates.map((c) => c.primary_evacuee_id)).toEqual(['EV1', 'EV9']);

		await session.chooseCandidate('EV1');

		expect(deps.lookup).toHaveBeenLastCalledWith({
			source: 'phone',
			phone: '0812345678',
			primary_evacuee_id: 'EV1'
		});
		expect(session.step).toBe('members');
		expect(session.selectedIds).toEqual([]);
	});

	it('goes back from members to the household list, then to the phone', async () => {
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockResolvedValueOnce(CANDIDATES)
			.mockResolvedValueOnce(HOUSEHOLD);
		const { session } = setup({ lookup });
		session.phone = '0812345678';
		await session.submitPhone();
		await session.chooseCandidate('EV1');

		session.back();
		expect(session.step).toBe('candidates');
		session.back();
		expect(session.step).toBe('phone');
	});
});

describe('ReprintSession verify', () => {
	it('asks for four digits of the owner id before sending anything', async () => {
		const { deps, session } = setup();
		await toVerify(session);

		expect(session.step).toBe('verify');
		session.idLast4 = '12';
		expect(session.canVerify).toBe(false);
		await session.submitVerify();
		expect(deps.reprint).not.toHaveBeenCalled();
	});

	it('sends phone, owner, last four and the ticked members', async () => {
		const { deps, session } = setup();
		await toVerify(session);
		session.toggleMember('EV2');
		session.idLast4 = '1234';

		await session.submitVerify();

		expect(deps.reprint).toHaveBeenCalledWith({
			phone: '0812345678',
			primary_evacuee_id: 'EV1',
			id_last4: '1234',
			evacuee_ids: ['EV1']
		});
	});

	it('keeps the step, clears the digits and says so after a wrong last four', async () => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', 403, 'KIOSK_REPRINT_VERIFY_FAILED'));
		const { deps, session } = setup({ reprint });
		await toVerify(session);
		session.idLast4 = '9999';

		await session.submitVerify();

		expect(session.step).toBe('verify');
		expect(session.idLast4).toBe('');
		expect(session.error).toBe('เลข 4 ตัวท้ายไม่ถูกต้อง');
		expect(deps.print).not.toHaveBeenCalled();
		expect(session.busy).toBe(false);
	});

	it('clears the error as soon as the visitor types again', async () => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', 403, 'KIOSK_REPRINT_VERIFY_FAILED'));
		const { session } = setup({ reprint });
		await toVerify(session);
		session.idLast4 = '9999';
		await session.submitVerify();

		session.idLast4 = '9';

		expect(session.error).toBe('');
	});

	it.each([
		['KIOSK_RATE_LIMITED', 429, 'ลองผิดหลายครั้ง กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่'],
		['KIOSK_REPRINT_UNVERIFIABLE', 403, 'ไม่สามารถยืนยันตัวตนได้ กรุณาติดต่อเจ้าหน้าที่']
	])('maps %s and stays on verify', async (code, status, text) => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', status, code));
		const { session } = setup({ reprint });
		await toVerify(session);
		session.idLast4 = '1234';

		await session.submitVerify();

		expect(session.step).toBe('verify');
		expect(session.error).toBe(text);
		expect(session.idLast4).toBe('');
	});

	it('returns to the phone step when the server no longer finds the household', async () => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', 404, 'KIOSK_REPRINT_NOT_FOUND'));
		const { session } = setup({ reprint });
		await toVerify(session);
		session.idLast4 = '1234';

		await session.submitVerify();

		expect(session.step).toBe('phone');
		expect(session.error).toBe('ไม่พบข้อมูลที่ลงทะเบียนด้วยเบอร์นี้');
		expect(session.members).toEqual([]);
	});

	it('goes back from verify to the member list and forgets the digits', async () => {
		const { session } = setup();
		await toVerify(session);
		session.idLast4 = '12';

		session.back();

		expect(session.step).toBe('members');
		expect(session.idLast4).toBe('');
	});
});

describe('ReprintSession printing', () => {
	it('prints the labels the server returned and then reports done', async () => {
		let finishPrint: (result: { kind: 'printed'; printed: number }) => void = () => {};
		const print = vi.fn<ReprintSessionDeps['print']>().mockImplementation(
			() =>
				new Promise((resolve) => {
					finishPrint = resolve;
				})
		);
		const { deps, session } = setup({ print });
		await toVerify(session);
		session.idLast4 = '1234';

		const submitting = session.submitVerify();
		await vi.waitFor(() => expect(session.step).toBe('printing'));
		expect(deps.print).toHaveBeenCalledWith(REPRINT_RESULT.members);
		expect(session.idLast4).toBe('');

		finishPrint({ kind: 'printed', printed: 2 });
		await submitting;

		expect(session.step).toBe('done');
		expect(session.printedCount).toBe(2);
		expect(session.busy).toBe(false);
	});

	it('also counts a browser-print fallback as done', async () => {
		const print = vi.fn<ReprintSessionDeps['print']>().mockResolvedValue({ kind: 'fallback' });
		const { session } = setup({ print });
		await toVerify(session);
		session.idLast4 = '1234';

		await session.submitVerify();

		expect(session.step).toBe('done');
		expect(session.printedCount).toBe(2);
	});

	it('keeps the verified labels for another try when the printer fails, without asking again', async () => {
		const print = vi
			.fn<ReprintSessionDeps['print']>()
			.mockResolvedValueOnce({ kind: 'error', message: 'เครื่องพิมพ์ไม่พร้อม' })
			.mockResolvedValueOnce({ kind: 'printed', printed: 2 });
		const { deps, session } = setup({ print });
		await toVerify(session);
		session.idLast4 = '1234';

		await session.submitVerify();
		expect(session.step).toBe('print_failed');
		expect(session.error).toBe('เครื่องพิมพ์ไม่พร้อม');

		await session.retryPrint();
		expect(session.step).toBe('done');
		expect(deps.reprint).toHaveBeenCalledTimes(1);
		expect(deps.print).toHaveBeenCalledTimes(2);
	});

	it('reports a thrown print as a failure instead of leaving the page on printing', async () => {
		const print = vi.fn<ReprintSessionDeps['print']>().mockRejectedValue(new Error('boom'));
		const { session } = setup({ print });
		await toVerify(session);
		session.idLast4 = '1234';

		await session.submitVerify();

		expect(session.step).toBe('print_failed');
		expect(session.error).toBe('สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ');
	});

	it('reset forgets everything, including the verified labels', async () => {
		const print = vi
			.fn<ReprintSessionDeps['print']>()
			.mockResolvedValue({ kind: 'error', message: 'x' });
		const { session } = setup({ print });
		await toVerify(session);
		session.idLast4 = '1234';
		await session.submitVerify();

		session.reset();

		expect(session.step).toBe('phone');
		expect(session.phone).toBe('');
		expect(session.members).toEqual([]);
		expect(session.selectedIds).toEqual([]);
		expect(session.printable).toEqual([]);
		expect(session.error).toBe('');
	});
});

async function toStaffPin(session: ReprintSession) {
	await toVerify(session);
	session.openStaffPin();
}

describe('ReprintSession staff PIN', () => {
	it('lets staff confirm with the kiosk PIN instead of the last four digits, then prints', async () => {
		const { deps, session } = setup();
		await toStaffPin(session);
		expect(session.step).toBe('staff_pin');

		const result = await session.verifyStaffPin('2468');

		expect(result).toEqual({ kind: 'verified' });
		expect(deps.reprint).toHaveBeenCalledWith({
			phone: '0812345678',
			primary_evacuee_id: 'EV1',
			staff_pin: '2468',
			evacuee_ids: ['EV1', 'EV2']
		});
		expect(deps.print).not.toHaveBeenCalled();

		await session.onStaffPinVerified();

		expect(deps.print).toHaveBeenCalledWith(REPRINT_RESULT.members);
		expect(session.step).toBe('done');
		expect(session.printedCount).toBe(2);
	});

	it('reports a wrong PIN as wrong, prints nothing and stays on the PIN step', async () => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', 401, 'KIOSK_REPRINT_STAFF_PIN_INVALID'));
		const { deps, session } = setup({ reprint });
		await toStaffPin(session);

		const result = await session.verifyStaffPin('0000');
		await session.onStaffPinVerified();

		expect(result).toEqual({ kind: 'wrong' });
		expect(session.step).toBe('staff_pin');
		expect(deps.print).not.toHaveBeenCalled();
		expect(session.busy).toBe(false);
	});

	it('reports a kiosk without a PIN as not_set', async () => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', 409, 'staff_pin_not_set'));
		const { deps, session } = setup({ reprint });
		await toStaffPin(session);

		const result = await session.verifyStaffPin('2468');

		expect(result).toEqual({ kind: 'not_set' });
		expect(session.step).toBe('staff_pin');
		expect(deps.print).not.toHaveBeenCalled();
	});

	it('goes back to the phone step with the not-found message when the household is gone', async () => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', 404, 'KIOSK_REPRINT_NOT_FOUND'));
		const { session } = setup({ reprint });
		await toStaffPin(session);

		const result = await session.verifyStaffPin('2468');

		expect(result).toEqual({ kind: 'error' });
		expect(session.step).toBe('phone');
		expect(session.error).toBe('ไม่พบข้อมูลที่ลงทะเบียนด้วยเบอร์นี้');
		expect(session.members).toEqual([]);
	});

	it('returns to the last-four-digits step when the PIN panel is cancelled', async () => {
		const { session } = setup();
		await toStaffPin(session);

		session.cancelStaffPin();

		expect(session.step).toBe('verify');
		expect(session.idLast4).toBe('');
	});

	it.each([
		['a full queue', new KioskRequestError('x', 429, 'RATE_LIMITED')],
		['an unavailable dependency', new KioskRequestError('x', 503, 'DEPENDENCY_UNAVAILABLE')],
		['a network failure', new Error('boom')]
	])('reports %s as error and stays on the PIN step', async (_name, failure) => {
		const reprint = vi.fn<ReprintSessionDeps['reprint']>().mockRejectedValue(failure);
		const { deps, session } = setup({ reprint });
		await toStaffPin(session);

		const result = await session.verifyStaffPin('2468');

		expect(result).toEqual({ kind: 'error' });
		expect(session.step).toBe('staff_pin');
		expect(deps.print).not.toHaveBeenCalled();
	});

	it('goes back from the PIN step to the last four digits', async () => {
		const { session } = setup();
		await toStaffPin(session);

		session.back();

		expect(session.step).toBe('verify');
	});

	it('ignores an answer that arrives after the visit was reset', async () => {
		let answer: (result: KioskReprintResult) => void = () => {};
		const reprint = vi.fn<ReprintSessionDeps['reprint']>().mockImplementation(
			() =>
				new Promise((resolve) => {
					answer = resolve;
				})
		);
		const { deps, session } = setup({ reprint });
		await toStaffPin(session);

		const verifying = session.verifyStaffPin('2468');
		session.reset();
		answer(REPRINT_RESULT);
		const result = await verifying;
		await session.onStaffPinVerified();

		expect(result).toEqual({ kind: 'error' });
		expect(session.step).toBe('phone');
		expect(session.printable).toEqual([]);
		expect(deps.print).not.toHaveBeenCalled();
	});
});
