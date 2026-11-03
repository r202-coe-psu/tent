// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Volunteer } from '../domain/volunteer.schema';
import type { VolunteerAccessStatus } from '../domain/volunteer-access-status';
import VolunteerAccessActions from './volunteer-access-actions.svelte';

const mocks = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
// The dialogs have their own tests; here only whether the button is offered matters.
vi.mock('./volunteer-access-dialog.svelte', () => ({ default: function Stub() {} }));
vi.mock('./volunteer-qualification-dialog.svelte', () => ({ default: function Stub() {} }));

const COORDINATOR = ['shelter:SH001', 'SH001:volunteer_coordinator'];
const MANAGER = ['shelter:SH001', 'SH001:shelter_manager'];

const volunteer = {
	_id: 'volunteer:001',
	shelter_code: 'SH001',
	status: 'active',
	identity_verified: true,
	identity_verification: { status: 'verified' }
} as unknown as Volunteer;

const unverified = {
	identity_verified: false,
	identity_verification: { status: 'pending' }
} as Partial<Volunteer>;

let instance: ReturnType<typeof mount> | null = null;

async function render(
	roles: string[],
	status: VolunteerAccessStatus,
	profile: Partial<Volunteer> = {}
) {
	mocks.roles = roles;
	instance = mount(VolunteerAccessActions, {
		target: document.body,
		props: { volunteer: { ...volunteer, ...profile }, status, shelterLine: 'SH001' }
	});
	await tick();
	flushSync();
}

const labels = () =>
	[...document.body.querySelectorAll('button, a')].map((el) => el.textContent?.trim());

const active: VolunteerAccessStatus = { kind: 'active', loginName: 'vol@example.com', roles: [] };
const suspended: VolunteerAccessStatus = {
	kind: 'deactivated',
	loginName: 'vol@example.com',
	roles: []
};

beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('VolunteerAccessActions (CR-221 FR-9)', () => {
	it('offers a coordinator the edit button for an active account', async () => {
		await render(COORDINATOR, active);
		expect(labels()).toContain('แก้ไขสิทธิ์ใช้งาน');
	});

	it.each([
		['verified', {}],
		['not verified', unverified]
	])(
		'shows a coordinator no button, only the note, for a suspended account (%s)',
		async (_l, p) => {
			await render(COORDINATOR, suspended, p);
			expect(labels()).toEqual([]);
			expect(document.body.textContent).toContain('บัญชีถูกระงับโดยผู้ดูแลระบบ');
		}
	);

	it('keeps the manager the users-page link for a suspended account', async () => {
		await render(MANAGER, suspended);
		expect(labels()).toContain('จัดการบัญชีผู้ใช้');
		expect(document.body.textContent).not.toContain('บัญชีถูกระงับโดยผู้ดูแลระบบ');
	});

	it.each([
		['no account', { kind: 'none' } as VolunteerAccessStatus],
		['an active account', active],
		[
			'a lapsed account',
			{ kind: 'lapsed', loginName: 'vol@example.com', lastEnded: null } as VolunteerAccessStatus
		]
	])(
		'gives a coordinator no grant or edit button for a closed profile (%s)',
		async (_l, status) => {
			await render(COORDINATOR, status, { status: 'inactive' } as Partial<Volunteer>);
			expect(labels()).toEqual([]);
		}
	);

	it('still gives a verified, open profile with no account the grant button', async () => {
		await render(COORDINATOR, { kind: 'none' });
		expect(labels()).toContain('ออกสิทธิ์ใช้งานระบบ');
	});

	it('asks an unverified profile with no account to be verified first', async () => {
		await render(COORDINATOR, { kind: 'none' }, unverified);
		expect(labels()).toContain('ยืนยันตัวตนก่อนออกสิทธิ์');
	});
});
