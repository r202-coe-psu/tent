// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Volunteer } from '../domain/volunteer.schema';
import VolunteerManageDialog from './volunteer-manage-dialog.svelte';

const mocks = vi.hoisted(() => ({ reviewIdentity: vi.fn() }));

vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../application/queries', () => ({
	useUpdateVolunteer: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useReviewVolunteerIdentity: () => ({ mutateAsync: mocks.reviewIdentity, isPending: false }),
	useSkillOptions: () => ({ options: [], controlledValues: [] })
}));

const volunteer = {
	_id: 'volunteer:001',
	shelter_code: 'SH001',
	volunteer_code: 'V-001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: null,
	status: 'active',
	skills: [],
	checked_in: false,
	personnel_type: 'volunteer',
	identity_verified: false,
	identity_verification: { status: 'pending' }
} as unknown as Volunteer;

let instance: ReturnType<typeof mount> | null = null;

async function render(profile: Partial<Volunteer>) {
	instance = mount(VolunteerManageDialog, {
		target: document.body,
		props: {
			open: true,
			volunteer: { ...volunteer, ...profile },
			shelterLine: 'SH001',
			todayShift: null
		}
	});
	flushSync();
	await tick();
}

const button = (text: string) =>
	[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.reviewIdentity.mockResolvedValue({});
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('VolunteerManageDialog identity button', () => {
	it('confirms a pending identity with the green button', async () => {
		await render({});
		const confirm = button('ยืนยันตัวตน')!;
		expect(confirm.className).toContain('bg-emerald-600');
		confirm.click();
		await tick();
		expect(mocks.reviewIdentity).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'verified' })
		);
	});

	it('shows taking a verification back as an undo, not a green confirm', async () => {
		await render({
			identity_verified: true,
			identity_verification: { status: 'verified' }
		} as Partial<Volunteer>);
		expect(button('ส่งกลับรอตรวจ')).toBeUndefined();
		const undo = button('ยกเลิกการยืนยัน (กลับไปรอตรวจ)')!;
		expect(undo.className).not.toContain('emerald');
		expect(undo.className).toContain('text-amber-800');
		undo.click();
		await tick();
		expect(mocks.reviewIdentity).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'pending' })
		);
	});
});
