import { describe, expect, it, vi, type Mock } from 'vitest';
import { KioskRequestError } from '../data/kiosk-check-in.api';
import type { KioskVolunteerCardResult } from '../data/kiosk-volunteer-card.api';
import {
	VolunteerCardSession,
	type VolunteerCardSessionDeps
} from './volunteer-card-session.svelte';

type FakeDeps = { [K in keyof VolunteerCardSessionDeps]: Mock<VolunteerCardSessionDeps[K]> };

const FOUND: KioskVolunteerCardResult = {
	shelter_code: 'SH001',
	volunteer: { display_name: 'สมชาย ใจดี', volunteer_code: 'VOL-0042', qr_payload: 'qr-vol-42' }
};

function setup(overrides: Partial<FakeDeps> = {}) {
	const deps: FakeDeps = {
		lookup: vi.fn<VolunteerCardSessionDeps['lookup']>().mockResolvedValue(FOUND),
		print: vi
			.fn<VolunteerCardSessionDeps['print']>()
			.mockResolvedValue({ kind: 'printed', printed: 1 }),
		...overrides
	};
	return { deps, session: new VolunteerCardSession(deps) };
}

describe('VolunteerCardSession', () => {
	it('looks the phone up, shows the volunteer, and prints them once confirmed', async () => {
		const { deps, session } = setup();
		session.phone = '0812345678';

		await session.submitPhone();

		expect(deps.lookup).toHaveBeenCalledWith('0812345678');
		expect(session.step).toBe('confirm');
		expect(session.volunteer?.display_name).toBe('สมชาย ใจดี');
		expect(session.volunteer?.volunteer_code).toBe('VOL-0042');

		await session.confirmPrint();

		expect(deps.print).toHaveBeenCalledWith(FOUND.volunteer);
		expect(session.step).toBe('done');
	});

	it('also counts a browser-print fallback as done', async () => {
		const print = vi
			.fn<VolunteerCardSessionDeps['print']>()
			.mockResolvedValue({ kind: 'fallback' });
		const { session } = setup({ print });
		session.phone = '0812345678';
		await session.submitPhone();

		await session.confirmPrint();

		expect(session.step).toBe('done');
	});

	it('stays on the phone step with a contact-staff message when no volunteer matches', async () => {
		const lookup = vi
			.fn<VolunteerCardSessionDeps['lookup']>()
			.mockRejectedValue(new KioskRequestError('x', 404, 'KIOSK_VOLUNTEER_CARD_NOT_FOUND'));
		const { session } = setup({ lookup });
		session.phone = '0812345678';

		await session.submitPhone();

		expect(session.step).toBe('phone');
		expect(session.volunteer).toBeNull();
		expect(session.error).toBe('ไม่พบข้อมูลจิตอาสาที่ใช้เบอร์นี้ในศูนย์นี้ กรุณาติดต่อเจ้าหน้าที่');
	});

	it.each([
		['KIOSK_RATE_LIMITED', 429, 'ลองผิดหลายครั้ง กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่'],
		['KIOSK_METHOD_DISABLED', 403, 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่']
	])(
		'maps lookup error %s to a message and stays on the phone step',
		async (code, status, text) => {
			const lookup = vi
				.fn<VolunteerCardSessionDeps['lookup']>()
				.mockRejectedValue(new KioskRequestError('server text', status, code));
			const { session } = setup({ lookup });
			session.phone = '0812345678';

			await session.submitPhone();

			expect(session.step).toBe('phone');
			expect(session.error).toBe(text);
		}
	);

	it('shows the server message for any other failure', async () => {
		const lookup = vi
			.fn<VolunteerCardSessionDeps['lookup']>()
			.mockRejectedValue(new KioskRequestError('เชื่อมต่อช้า กรุณาลองอีกครั้ง', 0, 'TIMEOUT'));
		const { session } = setup({ lookup });
		session.phone = '0812345678';

		await session.submitPhone();

		expect(session.error).toBe('เชื่อมต่อช้า กรุณาลองอีกครั้ง');
	});

	it('keeps the volunteer for another try when the printer fails, without a new lookup', async () => {
		const print = vi
			.fn<VolunteerCardSessionDeps['print']>()
			.mockResolvedValueOnce({ kind: 'error', message: 'เครื่องพิมพ์ไม่พร้อม' })
			.mockResolvedValueOnce({ kind: 'printed', printed: 1 });
		const { deps, session } = setup({ print });
		session.phone = '0812345678';
		await session.submitPhone();

		await session.confirmPrint();
		expect(session.step).toBe('print_failed');
		expect(session.error).toBe('เครื่องพิมพ์ไม่พร้อม');

		await session.retryPrint();

		expect(session.step).toBe('done');
		expect(deps.lookup).toHaveBeenCalledTimes(1);
		expect(deps.print).toHaveBeenCalledTimes(2);
		expect(deps.print).toHaveBeenLastCalledWith(FOUND.volunteer);
	});

	it('goes back from confirm to the phone step and forgets the volunteer', async () => {
		const { session } = setup();
		session.phone = '0812345678';
		await session.submitPhone();

		session.back();

		expect(session.step).toBe('phone');
		expect(session.volunteer).toBeNull();
	});

	it('reset forgets the phone, the volunteer and the error from any step', async () => {
		const print = vi
			.fn<VolunteerCardSessionDeps['print']>()
			.mockResolvedValue({ kind: 'error', message: 'x' });
		const { session } = setup({ print });
		session.phone = '0812345678';
		await session.submitPhone();
		await session.confirmPrint();
		expect(session.step).toBe('print_failed');

		session.reset();

		expect(session.step).toBe('phone');
		expect(session.phone).toBe('');
		expect(session.volunteer).toBeNull();
		expect(session.error).toBe('');
	});

	it('ignores a lookup that resolves after reset', async () => {
		let finishLookup: (result: KioskVolunteerCardResult) => void = () => {};
		const lookup = vi.fn<VolunteerCardSessionDeps['lookup']>().mockImplementation(
			() =>
				new Promise((resolve) => {
					finishLookup = resolve;
				})
		);
		const { session } = setup({ lookup });
		session.phone = '0812345678';

		const submitting = session.submitPhone();
		session.reset();
		finishLookup(FOUND);
		await submitting;

		expect(session.step).toBe('phone');
		expect(session.volunteer).toBeNull();
	});

	it('does not look up a phone that is not submittable or while a lookup is in flight', async () => {
		let finishLookup: (result: KioskVolunteerCardResult) => void = () => {};
		const lookup = vi.fn<VolunteerCardSessionDeps['lookup']>().mockImplementation(
			() =>
				new Promise((resolve) => {
					finishLookup = resolve;
				})
		);
		const { deps, session } = setup({ lookup });

		session.phone = '081234';
		expect(session.canSubmitPhone).toBe(false);
		await session.submitPhone();
		expect(deps.lookup).not.toHaveBeenCalled();

		session.phone = '0812345678';
		expect(session.canSubmitPhone).toBe(true);
		const submitting = session.submitPhone();
		expect(session.busy).toBe(true);
		expect(session.canSubmitPhone).toBe(false);
		await session.submitPhone();
		expect(deps.lookup).toHaveBeenCalledTimes(1);

		finishLookup(FOUND);
		await submitting;
		expect(session.busy).toBe(false);
	});

	it('clears the error as soon as the visitor types again', async () => {
		const lookup = vi
			.fn<VolunteerCardSessionDeps['lookup']>()
			.mockRejectedValue(new KioskRequestError('x', 404, 'KIOSK_VOLUNTEER_CARD_NOT_FOUND'));
		const { session } = setup({ lookup });
		session.phone = '0812345678';
		await session.submitPhone();

		session.phone = '081234567';

		expect(session.error).toBe('');
	});

	it('ignores a print result that arrives after reset', async () => {
		let finishPrint: (result: { kind: 'printed'; printed: number }) => void = () => {};
		const print = vi.fn<VolunteerCardSessionDeps['print']>().mockImplementation(
			() =>
				new Promise((resolve) => {
					finishPrint = resolve;
				})
		);
		const { session } = setup({ print });
		session.phone = '0812345678';
		await session.submitPhone();

		const printing = session.confirmPrint();
		expect(session.step).toBe('printing');
		session.reset();
		finishPrint({ kind: 'printed', printed: 1 });
		await printing;

		expect(session.step).toBe('phone');
	});

	it('reports a thrown print as a failure instead of leaving the page on printing', async () => {
		const print = vi.fn<VolunteerCardSessionDeps['print']>().mockRejectedValue(new Error('boom'));
		const { session } = setup({ print });
		session.phone = '0812345678';
		await session.submitPhone();

		await session.confirmPrint();

		expect(session.step).toBe('print_failed');
		expect(session.error).toBe('สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ');
	});

	it('only prints from confirm and only retries from print_failed', async () => {
		const { deps, session } = setup();

		await session.confirmPrint();
		await session.retryPrint();
		expect(deps.print).not.toHaveBeenCalled();

		session.phone = '0812345678';
		await session.submitPhone();
		await session.retryPrint();
		expect(deps.print).not.toHaveBeenCalled();
	});
});
