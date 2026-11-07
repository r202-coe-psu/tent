// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';
import type { VolunteerAccessStatus } from '../domain/volunteer-access-status';
import type { Volunteer } from '../domain/volunteer.schema';
import RosterRow from './roster-row.svelte';

const mocks = vi.hoisted(() => ({ roles: [] as string[], qualificationDialog: vi.fn() }));

vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
// The dialogs have their own tests; here only what the row offers matters.
vi.mock('./volunteer-access-dialog.svelte', () => ({ default: function Stub() {} }));
vi.mock('./volunteer-qualification-dialog.svelte', () => ({ default: mocks.qualificationDialog }));
vi.mock('../application/queries', () => ({
	useSkillOptions: () => ({ options: [] }),
	useCheckIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCheckOut: () => ({ mutateAsync: vi.fn(), isPending: false }),
	lookupVolunteerByScanCode: vi.fn()
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('html5-qrcode', () => ({
	Html5Qrcode: class {
		isScanning = false;
		start() {
			this.isScanning = true;
			return Promise.resolve();
		}
		stop() {
			return Promise.resolve();
		}
	}
}));

const TODAY = '2026-09-05';
const COORDINATOR = ['shelter:SH001', 'SH001:volunteer_coordinator'];

const volunteer = {
	_id: 'volunteer:001',
	shelter_code: 'SH001',
	status: 'active',
	volunteer_code: 'V-001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	personnel_type: 'volunteer',
	identity_verified: true,
	checked_in: false,
	phone: null,
	skills: []
} as unknown as Volunteer;

function makeAssignment(overrides: Partial<ShiftAssignment>): ShiftAssignment {
	return {
		_id: 'shift_assignment:1',
		volunteer_id: 'volunteer:001',
		job_id: 'job:1',
		station: 'ครัว',
		shift: 'morning',
		status: 'assigned',
		date: TODAY,
		duty_window: { start_ts: '2026-09-05T01:00:00.000Z', end_ts: '2026-09-05T09:00:00.000Z' },
		check_in_at: null,
		...overrides
	} as ShiftAssignment;
}

let instance: ReturnType<typeof mount> | null = null;

async function render(
	assignment: ShiftAssignment,
	vol: Volunteer = volunteer,
	accessStatus: VolunteerAccessStatus | null = null,
	extra: { canVerify?: boolean; accountsPending?: boolean } = {}
) {
	instance = mount(RosterRow, {
		target: document.body,
		props: {
			assignment,
			volunteer: vol,
			jobTitle: 'งานครัว',
			today: TODAY,
			accessStatus,
			canVerify: extra.canVerify ?? mocks.roles === COORDINATOR,
			accountsPending: extra.accountsPending ?? false,
			shelterLine: 'SH001',
			onhistory: vi.fn()
		}
	});
	flushSync();
	await tick();
}

const texts = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim());

afterEach(async () => {
	mocks.roles = [];
	mocks.qualificationDialog.mockClear();
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('RosterRow attendance actions', () => {
	it('offers check-in for a shift dated today', async () => {
		await render(makeAssignment({ date: TODAY }));
		expect(texts()).toContain('เช็คอินเข้างาน');
	});

	it('offers no check-in for a shift on another date', async () => {
		await render(makeAssignment({ date: '2026-09-06' }));
		expect(texts()).not.toContain('เช็คอินเข้างาน');
		expect(document.body.textContent).toContain('รับกะแล้ว');
	});

	it('offers no check-in for a standby shift on another date', async () => {
		await render(makeAssignment({ date: '2026-09-04', status: 'standby' }));
		expect(texts()).not.toContain('เช็คอินเข้างาน');
	});

	it('still offers check-out on any date for someone checked in (overnight shift)', async () => {
		await render(makeAssignment({ date: '2026-09-04', status: 'checked_in' }));
		expect(texts()).toContain('เช็คเอาต์ออกงาน');
	});

	it('blocks an unverified volunteer today, but shows plain status on another date', async () => {
		const unverified = { ...volunteer, identity_verified: false } as Volunteer;
		await render(makeAssignment({ date: TODAY }), unverified);
		expect(texts()).not.toContain('เช็คอินเข้างาน');
		expect(document.body.textContent).toContain('ต้องให้ จนท. ตรวจบัตร ปชช. ก่อนเข้ากะ');
	});

	it('opens the scan dialog with the "08:00 - 16:00 น." shift label the applicants tab uses', async () => {
		await render(makeAssignment({ date: TODAY }));
		(
			[...document.body.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'เช็คอินเข้างาน'
			) as HTMLButtonElement
		).click();
		await vi.waitFor(() => flushSync());
		await tick();

		expect(document.body.textContent).toContain('2026-09-05 · 08:00 - 16:00 น.');
	});
});

describe('RosterRow identity check and system access (CR-221 FR-24, FR-25)', () => {
	const unverified = {
		...volunteer,
		identity_verified: false,
		identity_verification: { status: 'pending' }
	} as unknown as Volunteer;

	it('offers "ยืนยันตัวตน" to a coordinator on a row waiting for the identity check', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }), unverified);
		expect(texts()).toContain('ยืนยันตัวตน');
		expect(texts()).not.toContain('เช็คอินเข้างาน');
	});

	it('opens the identity check only when "ยืนยันตัวตน" is pressed (one dialog, mounted on demand)', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }), unverified);
		expect(mocks.qualificationDialog).not.toHaveBeenCalled();

		[...document.body.querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === 'ยืนยันตัวตน')!
			.click();
		flushSync();
		await tick();
		expect(mocks.qualificationDialog).toHaveBeenCalledTimes(1);
		expect(mocks.qualificationDialog.mock.calls[0][1]).toMatchObject({
			volunteer: unverified,
			shelterLine: 'SH001'
		});
	});

	it('keeps the locked badge for staff who cannot verify', async () => {
		mocks.roles = ['shelter:SH001', 'SH001:registration_staff'];
		await render(makeAssignment({ date: TODAY }), unverified);
		expect(texts()).not.toContain('ยืนยันตัวตน');
		// The status badge and the lock badge both say it.
		expect(document.body.textContent?.split('รอยืนยันตัวตน').length).toBe(3);
	});

	it('does not repeat the identity check in the account strip', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }), unverified, { kind: 'none' });
		expect(texts().filter((t) => t?.includes('ยืนยันตัวตน'))).toEqual(['ยืนยันตัวตน']);
		expect(document.body.textContent).toContain('ยังไม่มีบัญชีระบบ');
	});

	it('offers no identity check once verified: the row checks in', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }));
		expect(texts()).not.toContain('ยืนยันตัวตน');
		expect(texts()).toContain('เช็คอินเข้างาน');
	});

	it('shows the system account and its access button when given an account status', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }), volunteer, { kind: 'none' });
		expect(document.body.textContent).toContain('บัญชีระบบ:');
		expect(texts()).toContain('ออกสิทธิ์ใช้งานระบบ');
	});

	it('shows the login of an existing account and offers to edit it', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }), volunteer, {
			kind: 'active',
			loginName: 'vol@example.com',
			roles: []
		});
		expect(document.body.textContent).toContain('vol@example.com');
		expect(texts()).toContain('แก้ไขสิทธิ์ใช้งาน');
	});

	it('shows a placeholder, not a guessed status, while the accounts load', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }), volunteer, null, { accountsPending: true });
		expect(document.body.querySelector('[data-testid="roster-account-pending"]')).not.toBeNull();
		expect(document.body.textContent).not.toContain('บัญชีระบบ:');
	});

	it('gives the roster badge its own test id, apart from the people tab', async () => {
		mocks.roles = COORDINATOR;
		await render(makeAssignment({ date: TODAY }), volunteer, { kind: 'none' });
		expect(document.body.querySelector('[data-testid="roster-account-status"]')).not.toBeNull();
		expect(document.body.querySelector('[data-testid="volunteer-account-status"]')).toBeNull();
	});

	it('hides the account strip without an account status', async () => {
		await render(makeAssignment({ date: TODAY }));
		expect(document.body.textContent).not.toContain('บัญชีระบบ:');
	});
});
