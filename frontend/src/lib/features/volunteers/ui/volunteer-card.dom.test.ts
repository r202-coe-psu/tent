// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Volunteer } from '../domain/volunteer.schema';
import type { VolunteerAccessStatus } from '../domain/volunteer-access-status';
import VolunteerCard from './volunteer-card.svelte';

vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const COORDINATOR = ['shelter:SH001', 'SH001:volunteer_coordinator'];
const auth = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: auth.roles };
		}
	}
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

async function render(accessStatus: VolunteerAccessStatus) {
	// The row is a <tr>: give it a table to live in.
	const table = document.createElement('table');
	const body = document.createElement('tbody');
	table.append(body);
	document.body.append(table);
	instance = mount(VolunteerCard, {
		target: body,
		props: {
			volunteer,
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

beforeEach(() => {
	vi.clearAllMocks();
	auth.roles = COORDINATOR;
});
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

	it('warns a shelter manager that a manager-given role stays and only the manager can take it back', async () => {
		auth.roles = ['shelter:SH001', 'SH001:shelter_manager'];
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

describe('VolunteerCard close button for a manager-given role (CR-221 A1-6)', () => {
	const closeButton = () =>
		document.body.querySelector<HTMLButtonElement>('[aria-label="ปิดใช้งานอาสาสมัคร"]')!;
	const REASON = 'จิตอาสามีสิทธิ์ถาวรจากผู้จัดการศูนย์ ให้ผู้จัดการศูนย์ปิดหรือถอนสิทธิ์ก่อน';

	it('is disabled for a coordinator, with the reason', async () => {
		await render({ kind: 'active', loginName: 'vol@example.com', roles: [grantRole, managerRole] });
		expect(closeButton().disabled).toBe(true);
		expect(document.body.textContent).toContain(REASON);
	});

	it('stays open to a coordinator when the account holds coordinator grants only', async () => {
		await render({ kind: 'active', loginName: 'vol@example.com', roles: [grantRole] });
		expect(closeButton().disabled).toBe(false);
		expect(document.body.textContent).not.toContain(REASON);
	});

	it('stays open to a shelter manager', async () => {
		auth.roles = ['shelter:SH001', 'SH001:shelter_manager'];
		await render({ kind: 'active', loginName: 'vol@example.com', roles: [managerRole] });
		expect(closeButton().disabled).toBe(false);
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
