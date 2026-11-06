// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Volunteer } from '../domain/volunteer.schema';
import type { VolunteerAccessStatus } from '../domain/volunteer-access-status';
import type { SkillOption } from '../domain/skill-catalog';
import VolunteerCard from './volunteer-card.svelte';

vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { user: { name: 'u', roles: ['shelter:SH001', 'SH001:volunteer_coordinator'] } }
}));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('../application/queries', () => ({
	useDeactivateVolunteer: () => ({ mutate: vi.fn(), isPending: false }),
	useReactivateVolunteer: () => ({ mutate: vi.fn(), isPending: false })
}));
// The dialogs and the access button have their own tests.
vi.mock('./volunteer-manage-dialog.svelte', () => ({ default: function Stub() {} }));
vi.mock('./volunteer-qualification-dialog.svelte', () => ({ default: function Stub() {} }));
vi.mock('./volunteer-access-actions.svelte', () => ({ default: function Stub() {} }));

const volunteer = {
	_id: 'volunteer:001',
	shelter_code: 'SH001',
	volunteer_code: 'V-001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	status: 'active',
	source: 'staff_entry',
	personnel_type: 'volunteer',
	checked_in: false,
	phone: null,
	skills: [],
	identity_verified: true,
	identity_verification: { status: 'verified' }
} as unknown as Volunteer;

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await tick();
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render(
	accessStatus: VolunteerAccessStatus,
	profile: Partial<Volunteer> = {},
	skillOptions: SkillOption[] = []
) {
	// The row is a <tr>: give it a table to live in.
	const table = document.createElement('table');
	const body = document.createElement('tbody');
	table.append(body);
	document.body.append(table);
	instance = mount(VolunteerCard, {
		target: body,
		props: {
			volunteer: { ...volunteer, ...profile },
			skillOptions,
			shelterName: 'ศูนย์ 1',
			shelterType: null,
			todayAssignment: null,
			accessStatus
		}
	});
	await settle();
}

async function openCloseDialog() {
	document.body.querySelector<HTMLButtonElement>('[aria-label="ปิดใช้งานอาสาสมัคร"]')!.click();
	await settle();
}

const byTestId = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);

const grantRole = {
	role: 'kitchen_staff',
	label: 'เจ้าหน้าที่ครัว',
	expiresAt: '2026-11-04T16:59:59.999Z'
};
const managerRole = { role: 'warehouse_staff', label: 'เจ้าหน้าที่คลัง', expiresAt: null };

beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('VolunteerCard close-profile notices (CR-221 FR-20)', () => {
	it('says a coordinator grant is revoked on close, and nothing about a manager role', async () => {
		await render({ kind: 'active', loginName: 'vol@example.com', roles: [grantRole] });
		await openCloseDialog();
		expect(byTestId('close-revokes-grants')?.textContent).toContain(
			'ถ้าไม่เปิดใช้งานคืนภายใน 5 นาที สิทธิ์ใช้งานระบบที่ผู้ประสานงานออกให้จะถูกถอนอัตโนมัติ'
		);
		expect(byTestId('close-keeps-manager-role')).toBeNull();
	});

	it('warns that a manager-given role stays and only the manager can take it back', async () => {
		await render({ kind: 'active', loginName: 'vol@example.com', roles: [managerRole] });
		await openCloseDialog();
		expect(byTestId('close-keeps-manager-role')?.textContent).toContain('ต้องให้ผู้จัดการศูนย์ถอน');
		expect(byTestId('close-revokes-grants')).toBeNull();
	});

	it('shows no access notice for a profile without an account', async () => {
		await render({ kind: 'none' });
		await openCloseDialog();
		expect(byTestId('close-revokes-grants')).toBeNull();
		expect(byTestId('close-keeps-manager-role')).toBeNull();
	});
});

describe('VolunteerCard account badge when the role here ended', () => {
	it('shows the role it was, how it ended and when', async () => {
		await render({
			kind: 'lapsed',
			loginName: 'vol@example.com',
			lastEnded: {
				role: 'warehouse_staff',
				reason: 'revoked',
				at: '2026-11-02T07:06:06.813Z',
				by: 'worker',
				cause: 'profile_inactive'
			}
		});
		const badge = byTestId('volunteer-account-status')!.textContent!;
		expect(badge).toContain('สิทธิ์ในศูนย์นี้สิ้นสุดแล้ว');
		expect(badge).toContain('เคยเป็น เจ้าหน้าที่คลัง');
		expect(badge).toContain('ถูกถอนเพราะปิดโปรไฟล์');
		expect(badge).toContain('· เมื่อ');
	});
});

describe('VolunteerCard identity status', () => {
	const medical: SkillOption = {
		code: 'medical',
		label: 'การแพทย์ / ปฐมพยาบาล',
		description: '',
		icon: '🩺',
		controlled: true
	};
	const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

	it('shows a rejected identity and skill as not passed, not as waiting', async () => {
		await render(
			{ kind: 'none' },
			{
				skills: ['medical'],
				identity_verified: false,
				identity_verification: { status: 'rejected' },
				skill_verifications: { medical: { status: 'rejected' } }
			} as Partial<Volunteer>,
			[medical]
		);
		expect(text()).toContain('ไม่ผ่านการยืนยันตัวตน');
		expect(text()).toContain('ทักษะควบคุมไม่ผ่านการรับรอง');
		expect(text()).not.toContain('รอยืนยันตัวตน');
	});

	it('still shows a pending identity as waiting', async () => {
		await render({ kind: 'none' }, {
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);
		expect(text()).toContain('รอยืนยันตัวตน');
		expect(text()).not.toContain('ไม่ผ่านการยืนยันตัวตน');
	});
});
