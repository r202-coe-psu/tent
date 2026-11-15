// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Volunteer } from '../domain/volunteer.schema';
import { VolunteerPhoneTakenError } from '../domain/phone-errors';
import { toast } from 'svelte-sonner';
import VolunteerManageDialog from './volunteer-manage-dialog.svelte';

const MEDICAL = 'medical';

const mocks = vi.hoisted(() => ({
	update: vi.fn(),
	reviewIdentity: vi.fn(),
	get: vi.fn()
}));

vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../application/queries', () => ({
	useReviewVolunteerIdentity: () => ({ mutateAsync: mocks.reviewIdentity, isPending: false }),
	useUpdateVolunteer: () => ({ mutateAsync: mocks.update, isPending: false }),
	fetchVolunteer: (_qc: unknown, id: string) => mocks.get(id),
	useSkillOptions: () => ({
		options: [{ code: MEDICAL, label: 'การแพทย์', description: '', icon: '🩺', controlled: true }],
		controlledValues: [MEDICAL, 'การแพทย์']
	})
}));

const base = {
	shelter_code: 'SH001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	status: 'active',
	national_id: null,
	identity_verified: false,
	identity_verification: { status: 'pending' },
	skill_verifications: {},
	personnel_type: 'volunteer',
	phone: '0812345678'
};

// The profile the dialog was opened for: on duty, has a login, holds the medical skill.
const opened = {
	...base,
	_id: 'volunteer:a',
	volunteer_code: 'V-001',
	checked_in: true,
	user_name: 'acct-a',
	skills: [MEDICAL]
} as unknown as Volunteer;

// The closed profile that already owns the phone: off duty, no login, no skill.
const holder = {
	...base,
	_id: 'volunteer:b',
	volunteer_code: 'V-002',
	first_name: 'สมหญิง',
	status: 'inactive',
	checked_in: false,
	user_name: null,
	skills: []
} as unknown as Volunteer;

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

const button = (text: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes(text)
	);
const bodyText = () => document.body.textContent ?? '';

async function openWithConflict() {
	mocks.update.mockRejectedValue(
		new VolunteerPhoneTakenError([
			{
				_id: holder._id,
				volunteer_code: holder.volunteer_code,
				first_name: holder.first_name,
				last_name: holder.last_name,
				status: 'inactive'
			}
		])
	);
	mocks.get.mockResolvedValue(holder);
	instance = mount(VolunteerManageDialog, {
		target: document.body,
		props: { open: true, volunteer: opened, shelterLine: 'ศูนย์ทดสอบ', todayShift: null }
	});
	await settle();
	button('บันทึกข้อมูลอาสาสมัคร')!.click();
	await settle();
}

beforeEach(() => {
	mocks.update.mockReset();
	mocks.reviewIdentity.mockReset();
	mocks.get.mockReset();
	vi.mocked(toast.error).mockClear();
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('VolunteerManageDialog — phone already taken (CR-239 FR-11, FR-12)', () => {
	it('shows the conflict, and for a closed profile says to reopen it instead of creating a new one', async () => {
		await openWithConflict();
		expect(bodyText()).toContain('พบโปรไฟล์ที่ใช้เบอร์นี้แล้วในศูนย์');
		expect(button('เปิดโปรไฟล์ V-002')?.textContent).toContain('(ปิดใช้งานอยู่)');
		expect(bodyText()).toContain('เปิดใช้งานอีกครั้ง');
	});

	it('shows the conflict as one toast (message only) plus the panel with the open button (Suggestion 6)', async () => {
		await openWithConflict();
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(
			expect.stringContaining('เบอร์นี้มีอยู่แล้วในศูนย์: V-002 สมหญิง ใจดี')
		);
		expect(button('เปิดโปรไฟล์ V-002')).toBeDefined();
	});

	it('after switching to the other profile, every part shows that profile and none of the first', async () => {
		await openWithConflict();
		button('เปิดโปรไฟล์ V-002')!.click();
		await settle();

		const title = document.body.querySelector('[data-slot="dialog-title"]')?.textContent ?? '';
		expect(title).toContain('V-002');
		expect(title).not.toContain('V-001');
		expect(bodyText()).toContain('ไม่ได้ปฏิบัติหน้าที่');
		expect(bodyText()).not.toContain('ปฏิบัติหน้าที่อยู่');
		expect(bodyText()).toContain('ยังไม่มีบัญชีหลังบ้าน');
		expect(bodyText()).not.toContain('acct-a');
	});

	it('does not offer the qualification audit while another profile is swapped in', async () => {
		await openWithConflict();
		button('เปิดโปรไฟล์ V-002')!.click();
		await settle();
		const audit = button('ตรวจสอบ/รับรองทักษะนี้');
		expect(audit === undefined || audit.disabled).toBe(true);
	});

	it('refreshes the swapped-in profile after an identity review', async () => {
		await openWithConflict();
		button('เปิดโปรไฟล์ V-002')!.click();
		await settle();
		mocks.reviewIdentity.mockResolvedValue(undefined);
		mocks.get.mockResolvedValue({
			...holder,
			identity_verified: true,
			identity_verification: { status: 'verified' }
		});

		button('ยืนยันตัวตน')!.click();
		await settle();

		expect(mocks.reviewIdentity).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'volunteer:b', status: 'verified' })
		);
		expect(button('ส่งกลับรอตรวจ')).toBeDefined();
	});
});
