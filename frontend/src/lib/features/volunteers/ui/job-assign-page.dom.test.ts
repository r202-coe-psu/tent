// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import { shiftDutyWindow } from '../domain/duty-window';
import type { Job, JobShift } from '../domain/job.schema';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';
import type { Volunteer } from '../domain/volunteer.schema';
import JobAssignPage from './job-assign-page.svelte';

const shift = (id: string, start: string, end: string, quota = 5): JobShift => ({
	id,
	date: '2026-11-10',
	end_date: '2026-11-10',
	start_time: start,
	end_time: end,
	quota
});
const MORNING = shift('js-morning', '08:00', '12:00');
const AFTERNOON = shift('js-afternoon', '13:00', '17:00');
const EVENING = shift('js-evening', '18:00', '22:00', 1);

const volunteer = (n: number, name: string): Volunteer =>
	({
		_id: `volunteer:${n}`,
		type: 'volunteer',
		shelter_code: 'SH001',
		first_name: name,
		last_name: 'ทดสอบ',
		skills: [],
		status: 'active',
		volunteer_code: `V-00${n}`,
		identity_verified: true,
		checked_in: false,
		phone: null,
		source: 'walk_in',
		personnel_type: 'volunteer'
	}) as unknown as Volunteer;

const A = volunteer(1, 'สมชาย');
const B = volunteer(2, 'สมหญิง');

const job = {
	_id: 'job:1',
	shelter_code: 'SH001',
	title: 'ทีมครัว',
	skills_required: [],
	shifts: [MORNING, AFTERNOON, EVENING]
} as unknown as Job;

const mocks = vi.hoisted(() => ({
	assign: vi.fn(),
	assignments: [] as ShiftAssignment[]
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));
vi.mock('$lib/features/shelters', () => ({ useShelter: () => ({ data: { name: 'ศูนย์ 1' } }) }));
vi.mock('../application/queries', () => ({
	useAssignVolunteers: () => ({ mutateAsync: mocks.assign, isPending: false }),
	useJob: () => ({ data: job, isLoading: false }),
	useJobs: () => ({ data: [job], isLoading: false }),
	useShiftAssignments: () => ({
		get data() {
			return mocks.assignments;
		},
		isLoading: false
	}),
	useSkillOptions: () => ({ options: [], controlledValues: [] }),
	useVolunteers: () => ({ data: [A, B], isLoading: false })
}));

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(JobAssignPage, { target: document.body, props: { jobId: 'job:1' } });
	flushSync();
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

const byLabel = (label: string) =>
	document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const click = async (el: HTMLElement) => {
	el.click();
	flushSync();
	await tick();
};
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const sendButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.getAttribute('aria-label')?.startsWith('มอบหมายอาสา')
	)!;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.assign.mockResolvedValue({});
	mocks.assignments = [];
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('JobAssignPage — several shifts at once (#1164)', () => {
	it('keeps the single-shift flow when no other shift is ticked', async () => {
		await render();
		await click(byLabel('เลือก สมชาย ทดสอบ'));
		expect(sendButton().getAttribute('aria-label')).toBe('มอบหมายอาสา 1 คนเข้ากะนี้');
		await click(sendButton());
		expect(mocks.assign).toHaveBeenCalledTimes(1);
		expect(mocks.assign).toHaveBeenCalledWith(
			expect.objectContaining({ shift_id: 'js-morning', volunteer_id: A._id })
		);
		expect(document.body.querySelector('[data-testid="bulk-report"]')).toBeNull();
	});

	it('places the chosen people in every ticked shift', async () => {
		await render();
		await click(byLabel('มอบหมายเข้ากะ 2026-11-10 | 13:00 - 17:00 น. (0/5 คน) ด้วย'));
		await click(byLabel('เลือก สมชาย ทดสอบ'));
		await click(byLabel('เลือก สมหญิง ทดสอบ'));
		expect(sendButton().getAttribute('aria-label')).toBe('มอบหมายอาสา 2 คนเข้า 2 กะ');
		await click(sendButton());
		await new Promise((resolve) => setTimeout(resolve, 20));
		const sent = mocks.assign.mock.calls.map(([c]) => [c.shift_id, c.volunteer_id]);
		expect(sent).toEqual([
			['js-morning', A._id],
			['js-morning', B._id],
			['js-afternoon', A._id],
			['js-afternoon', B._id]
		]);
		expect(toast.success).toHaveBeenCalledWith('มอบหมายสำเร็จ 4 รายการ (2 คน × 2 กะ)');
		expect(document.body.querySelector('[data-testid="bulk-report"]')).toBeNull();
	});

	it('saves what it can and lists what it skipped', async () => {
		// A already holds the afternoon; the evening has one seat.
		mocks.assignments = [
			{
				volunteer_id: A._id,
				job_id: job._id,
				shift_id: AFTERNOON.id,
				duty_window: shiftDutyWindow(AFTERNOON),
				date: AFTERNOON.date,
				status: 'assigned'
			} as ShiftAssignment
		];
		await render();
		await click(byLabel('มอบหมายเข้ากะ 2026-11-10 | 13:00 - 17:00 น. (1/5 คน) ด้วย'));
		await click(byLabel('มอบหมายเข้ากะ 2026-11-10 | 18:00 - 22:00 น. (0/1 คน) ด้วย'));
		await click(byLabel('เลือก สมชาย ทดสอบ'));
		await click(byLabel('เลือก สมหญิง ทดสอบ'));
		await click(sendButton());
		await new Promise((resolve) => setTimeout(resolve, 20));

		const sent = mocks.assign.mock.calls.map(([c]) => [c.shift_id, c.volunteer_id]);
		expect(sent).toEqual([
			['js-morning', A._id],
			['js-morning', B._id],
			['js-afternoon', B._id],
			['js-evening', A._id]
		]);
		const report = text();
		expect(report).toContain('บันทึกแล้ว 4 รายการ · ข้ามหรือบันทึกไม่ได้ 2 รายการ');
		expect(report).toContain('สมชาย ทดสอบ — กะ 2026-11-10 13:00-17:00: อยู่ในกะนี้แล้ว');
		expect(report).toContain('สมหญิง ทดสอบ — กะ 2026-11-10 18:00-22:00: กะเต็มแล้ว');
		expect(toast.warning).toHaveBeenCalled();
	});

	it('lists a save that fails and keeps that person selected to retry', async () => {
		mocks.assign.mockImplementation(async (c: { shift_id: string; volunteer_id: string }) => {
			if (c.shift_id === 'js-afternoon' && c.volunteer_id === B._id)
				throw new Error('เครือข่ายขัดข้อง');
			return {};
		});
		await render();
		await click(byLabel('มอบหมายเข้ากะ 2026-11-10 | 13:00 - 17:00 น. (0/5 คน) ด้วย'));
		await click(byLabel('เลือก สมชาย ทดสอบ'));
		await click(byLabel('เลือก สมหญิง ทดสอบ'));
		await click(sendButton());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(text()).toContain('สมหญิง ทดสอบ — กะ 2026-11-10 13:00-17:00: เครือข่ายขัดข้อง');
		// Only the person with something left stays selected.
		expect(sendButton().getAttribute('aria-label')).toBe('มอบหมายอาสา 1 คนเข้า 2 กะ');
	});
});
