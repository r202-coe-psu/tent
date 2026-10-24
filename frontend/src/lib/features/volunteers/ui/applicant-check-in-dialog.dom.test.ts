// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';
import type { Volunteer } from '../domain/volunteer.schema';
import ApplicantCheckInDialog from './applicant-check-in-dialog.svelte';

const camera = vi.hoisted(() => ({
	decode: null as null | ((text: string) => void),
	stop: vi.fn()
}));
vi.mock('html5-qrcode', () => ({
	Html5Qrcode: class {
		isScanning = false;
		start(_cam: unknown, _cfg: unknown, onDecode: (text: string) => void) {
			camera.decode = onDecode;
			this.isScanning = true;
			return Promise.resolve();
		}
		stop() {
			camera.stop();
			return Promise.resolve();
		}
	}
}));

const mutateAsync = vi.fn();
const lookup = vi.fn();
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('../application/queries', () => ({
	useCheckIn: () => ({ mutateAsync, isPending: false }),
	lookupVolunteerByScanCode: (raw: string) => lookup(raw)
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const assignment = { _id: 'shift_assignment:1', volunteer_id: 'volunteer:001' } as ShiftAssignment;
const volunteer = {
	_id: 'volunteer:001',
	volunteer_code: 'V-001',
	first_name: 'สมชาย',
	last_name: 'ใจดี'
} as Volunteer;

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render() {
	instance = mount(ApplicantCheckInDialog, {
		target: document.body,
		props: {
			open: true,
			assignment,
			volunteer,
			personName: 'สมชาย ใจดี',
			shiftLabel: '2026-09-05 · 08:00 - 16:00 น.'
		}
	});
	await settle();
}

const confirmButton = () =>
	[...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'ยืนยันเช็คอิน'
	) as HTMLButtonElement;
const reasonInput = () => document.body.querySelector('input') as HTMLInputElement;

async function typeReason(text: string) {
	const input = reasonInput();
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

async function scan(text: string) {
	camera.decode?.(text);
	await settle();
}

beforeEach(() => {
	vi.clearAllMocks();
	camera.decode = null;
	mutateAsync.mockResolvedValue(assignment);
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('ApplicantCheckInDialog', () => {
	it('shows who is checking in, with code and shift', async () => {
		await render();
		const text = document.body.textContent ?? '';
		expect(text).toContain('สมชาย ใจดี');
		expect(text).toContain('V-001');
		expect(text).toContain('2026-09-05 · 08:00 - 16:00 น.');
	});

	it('closes without writing on ยกเลิก and stops the camera', async () => {
		await render();
		expect(camera.stop).not.toHaveBeenCalled();

		const cancel = [...document.body.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'ยกเลิก'
		);
		cancel?.click();
		await settle();

		expect(mutateAsync).not.toHaveBeenCalled();
		expect(camera.stop).toHaveBeenCalled();
	});

	describe('check in without scanning', () => {
		it('keeps ยืนยันเช็คอิน disabled until a reason is typed', async () => {
			await render();
			expect(confirmButton().disabled).toBe(true);

			await typeReason('   ');
			expect(confirmButton().disabled).toBe(true);

			await typeReason('ลืมโทรศัพท์');
			expect(confirmButton().disabled).toBe(false);
			expect(mutateAsync).not.toHaveBeenCalled();
		});

		it('checks in as manual_override with the trimmed reason', async () => {
			await render();
			await typeReason('  ลืมโทรศัพท์ ');
			confirmButton().click();
			await settle();

			expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
				id: 'shift_assignment:1',
				method: 'manual_override',
				reason: 'ลืมโทรศัพท์'
			});
			expect(toast.success).toHaveBeenCalledWith('เช็คอินเข้างาน สมชาย ใจดี แล้ว');
		});

		it('reports a failed check-in without claiming success', async () => {
			mutateAsync.mockRejectedValue(new Error('บันทึกไม่สำเร็จ'));
			await render();
			await typeReason('ลืมโทรศัพท์');
			confirmButton().click();
			await settle();

			expect(toast.error).toHaveBeenCalledWith('บันทึกไม่สำเร็จ');
			expect(toast.success).not.toHaveBeenCalled();
		});
	});

	describe('scanning the volunteer QR', () => {
		it('checks in with method qr when the QR is this volunteer', async () => {
			lookup.mockResolvedValue(volunteer);
			await render();
			await scan('https://x.test/volunteer/ticket/TKT-VOL-ABC');

			expect(lookup).toHaveBeenCalledWith('https://x.test/volunteer/ticket/TKT-VOL-ABC');
			expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
				id: 'shift_assignment:1',
				method: 'qr',
				reason: undefined
			});
			expect(toast.success).toHaveBeenCalledWith('เช็คอินเข้างาน สมชาย ใจดี แล้ว');
		});

		it('refuses a QR of another volunteer and names whose it is', async () => {
			lookup.mockResolvedValue({ ...volunteer, _id: 'volunteer:002', volunteer_code: 'V-002' });
			await render();
			await scan('V-002');

			expect(mutateAsync).not.toHaveBeenCalled();
			const alert = document.body.querySelector('[role="alert"]');
			expect(alert?.textContent).toContain('QR นี้เป็นของ สมชาย ใจดี (V-002) ไม่ใช่ สมชาย ใจดี');
		});

		it('refuses a QR that matches nobody', async () => {
			lookup.mockResolvedValue(null);
			await render();
			await scan('hello');

			expect(mutateAsync).not.toHaveBeenCalled();
			expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
				'ไม่พบอาสาสมัคร'
			);
		});

		it('treats a failing lookup as an unknown QR', async () => {
			lookup.mockRejectedValue(new Error('offline'));
			await render();
			await scan('TKT-VOL-X');

			expect(mutateAsync).not.toHaveBeenCalled();
			expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
		});
	});
});
