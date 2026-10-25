// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';
import type { Volunteer } from '../domain/volunteer.schema';
import ApplicantCheckOutDialog from './applicant-check-out-dialog.svelte';

const mutateAsync = vi.fn();
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('../application/queries', () => ({
	useCheckOut: () => ({ mutateAsync, isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const assignment = {
	_id: 'shift_assignment:1',
	volunteer_id: 'volunteer:001',
	check_in_at: '2026-09-05T01:30:00.000Z'
} as ShiftAssignment;
const volunteer = { _id: 'volunteer:001', volunteer_code: 'V-001' } as Volunteer;

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render() {
	instance = mount(ApplicantCheckOutDialog, {
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

const buttonByText = (text: string) =>
	[...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === text
	) as HTMLButtonElement;

beforeEach(() => {
	vi.clearAllMocks();
	mutateAsync.mockResolvedValue(assignment);
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('ApplicantCheckOutDialog', () => {
	it('shows who, which shift and when they checked in (Bangkok time)', async () => {
		await render();
		const text = document.body.textContent ?? '';
		expect(text).toContain('สมชาย ใจดี');
		expect(text).toContain('V-001');
		expect(text).toContain('2026-09-05 · 08:00 - 16:00 น.');
		expect(text).toContain('08:30');
	});

	it('checks out only after ยืนยันเช็คเอาต์ and says so', async () => {
		await render();
		expect(mutateAsync).not.toHaveBeenCalled();

		buttonByText('ยืนยันเช็คเอาต์').click();
		await settle();

		expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({ id: 'shift_assignment:1' });
		expect(toast.success).toHaveBeenCalledWith('เช็คเอาต์ออกงาน สมชาย ใจดี แล้ว');
		expect(buttonByText('ยืนยันเช็คเอาต์')).toBeUndefined();
	});

	it('closes without writing on ยกเลิก', async () => {
		await render();
		buttonByText('ยกเลิก').click();
		await settle();

		expect(mutateAsync).not.toHaveBeenCalled();
		expect(buttonByText('ยืนยันเช็คเอาต์')).toBeUndefined();
	});

	it('stays open and reports the error when check-out fails', async () => {
		mutateAsync.mockRejectedValue(new Error('บันทึกไม่สำเร็จ'));
		await render();
		buttonByText('ยืนยันเช็คเอาต์').click();
		await settle();

		expect(toast.error).toHaveBeenCalledWith('บันทึกไม่สำเร็จ');
		expect(toast.success).not.toHaveBeenCalled();
		expect(buttonByText('ยืนยันเช็คเอาต์')).toBeDefined();
	});
});
