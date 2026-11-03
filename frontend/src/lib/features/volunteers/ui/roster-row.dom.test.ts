// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';
import type { Volunteer } from '../domain/volunteer.schema';
import RosterRow from './roster-row.svelte';

vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
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

const volunteer = {
	_id: 'volunteer:001',
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

async function render(assignment: ShiftAssignment, vol: Volunteer = volunteer) {
	instance = mount(RosterRow, {
		target: document.body,
		props: { assignment, volunteer: vol, jobTitle: 'งานครัว', today: TODAY, onhistory: vi.fn() }
	});
	flushSync();
	await tick();
}

const texts = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim());

afterEach(async () => {
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
