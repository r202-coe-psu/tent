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
	assignments: [] as ShiftAssignment[],
	jobSkillsRequired: [] as string[],
	volunteers: null as Volunteer[] | null,
	skillOptions: [
		{
			code: 'cooking',
			label: 'ประกอบอาหาร / ครัวสนาม',
			description: '',
			icon: '✨',
			controlled: false
		}
	]
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));
vi.mock('$lib/features/shelters', () => ({ useShelter: () => ({ data: { name: 'ศูนย์ 1' } }) }));
vi.mock('../application/queries', () => ({
	useAssignVolunteers: () => ({ mutateAsync: mocks.assign, isPending: false }),
	useJob: () => ({
		get data() {
			return { ...job, skills_required: mocks.jobSkillsRequired };
		},
		isLoading: false
	}),
	useJobs: () => ({
		get data() {
			return [{ ...job, skills_required: mocks.jobSkillsRequired }];
		},
		isLoading: false
	}),
	useShiftAssignments: () => ({
		get data() {
			return mocks.assignments;
		},
		isLoading: false
	}),
	useSkillOptions: () => ({ options: mocks.skillOptions, controlledValues: [] }),
	useVolunteers: () => ({
		get data() {
			return mocks.volunteers ?? [A, B];
		},
		isLoading: false
	})
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
	mocks.jobSkillsRequired = [];
	mocks.volunteers = null;
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
		expect(document.body.querySelector('[data-testid="bulk-result"]')).toBeNull();
	});

	it('places the chosen people in every ticked shift', async () => {
		await render();
		await click(byLabel('เลือกกะ 2026-11-10 | 13:00 - 17:00 น. (0/5 คน)'));
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
		expect(document.body.querySelector('[data-testid="bulk-result"]')).toBeNull();
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
		await click(byLabel('เลือกกะ 2026-11-10 | 13:00 - 17:00 น. (1/5 คน)'));
		await click(byLabel('เลือกกะ 2026-11-10 | 18:00 - 22:00 น. (0/1 คน)'));
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
		// The result is a dialog in the middle of the screen, never a line at the bottom of the page.
		const dialog = document.body.querySelector('[data-testid="bulk-result"]')!;
		expect(dialog).not.toBeNull();
		const report = (dialog.textContent ?? '').replace(/\s+/g, ' ');
		expect(report).toContain('มอบหมายสำเร็จ 4 รายการ');
		expect(report).toContain('ไม่ได้มอบหมาย 2 รายการ');
		// สมชาย: placed in the morning, not in the afternoon (already there) nor the evening (one seat).
		expect(report).toContain('สมชาย ทดสอบ เข้ากะแล้ว 2026-11-10 08:00-12:00 น.');
		expect(report).toContain('กะ 2026-11-10 13:00-17:00 น. อยู่ในกะนี้อยู่แล้ว');
		expect(report).toContain('สมหญิง ทดสอบ เข้ากะแล้ว');
		expect(report).toContain('กะ 2026-11-10 18:00-22:00 น. กะนี้เต็มแล้ว');
		expect(toast.warning).not.toHaveBeenCalled();
	});

	it('lists a save that fails and keeps that person selected to retry', async () => {
		mocks.assign.mockImplementation(async (c: { shift_id: string; volunteer_id: string }) => {
			if (c.shift_id === 'js-afternoon' && c.volunteer_id === B._id)
				throw new Error('เครือข่ายขัดข้อง');
			return {};
		});
		await render();
		await click(byLabel('เลือกกะ 2026-11-10 | 13:00 - 17:00 น. (0/5 คน)'));
		await click(byLabel('เลือก สมชาย ทดสอบ'));
		await click(byLabel('เลือก สมหญิง ทดสอบ'));
		await click(sendButton());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(text()).toContain('กะ 2026-11-10 13:00-17:00 น. บันทึกไม่สำเร็จ (เครือข่ายขัดข้อง)');
		// Only the person whose save failed stays selected, to try again.
		expect(sendButton().getAttribute('aria-label')).toBe('มอบหมายอาสา 1 คนเข้า 2 กะ');
	});

	it('disables a shift when its quota is full and cannot be selected', async () => {
		// Evening has 1 seat and is full
		mocks.assignments = [
			{
				volunteer_id: A._id,
				job_id: job._id,
				shift_id: EVENING.id,
				duty_window: shiftDutyWindow(EVENING),
				date: EVENING.date,
				status: 'assigned'
			} as ShiftAssignment
		];
		await render();
		const eveningBtn = byLabel('เลือกกะ 2026-11-10 | 18:00 - 22:00 น. (1/1 คน)');
		expect(eveningBtn).not.toBeNull();
		expect(eveningBtn.hasAttribute('disabled')).toBe(true);
		await click(eveningBtn);
		// Still only morning is selected
		expect(sendButton().getAttribute('aria-label')).toBe('มอบหมายอาสา 0 คนเข้ากะนี้');
	});

	it('shows skill requirements and filters candidates by matching skill', async () => {
		const skilledA = { ...A, skills: ['cooking'] } as Volunteer;
		const unskilledB = { ...B, skills: [] } as Volunteer;
		mocks.volunteers = [skilledA, unskilledB];
		mocks.jobSkillsRequired = ['cooking'];

		await render();
		expect(text()).toContain('ทักษะที่ต้องการ: ประกอบอาหาร / ครัวสนาม');
		expect(text()).toContain('ทักษะตรงกับงาน');
		expect(text()).toContain('ตรงกับงานอาสาสมัครนี้ (1)');

		// Filter by match: only skilledA is visible
		const matchBtn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
			b.textContent?.includes('ตรงกับงานอาสาสมัครนี้')
		)!;
		await click(matchBtn);
		expect(document.body.querySelector('[aria-label="เลือก สมชาย ทดสอบ"]')).not.toBeNull();
		expect(document.body.querySelector('[aria-label="เลือก สมหญิง ทดสอบ"]')).toBeNull();
	});

	it('indicates that all candidates match when the job requires no skill', async () => {
		mocks.jobSkillsRequired = [];
		await render();
		expect(text()).toContain('ทักษะที่ต้องการ: ไม่จำกัดทักษะ (รับทุกทักษะ)');
		expect(text()).toContain('ตรงกับงานอาสาสมัครนี้');
	});

	it('paginates unassigned candidates at 10 items per page', async () => {
		const twelveVolunteers = Array.from({ length: 12 }, (_, i) =>
			volunteer(i + 1, `อาสาคนที่_${i + 1}`)
		);
		mocks.volunteers = twelveVolunteers;
		await render();

		// Page 1: shows candidates 1 to 10
		expect(text()).toContain('อาสาคนที่_1 ทดสอบ');
		expect(text()).toContain('อาสาคนที่_10 ทดสอบ');
		expect(text()).not.toContain('อาสาคนที่_11 ทดสอบ');
		expect(text()).toContain('แสดงหน้าที่ 1 จาก 2');

		// Click page 2 button
		const page2Btn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
			(b) => b.textContent?.trim() === '2'
		);
		expect(page2Btn).not.toBeNull();
		await click(page2Btn!);
		expect(text()).toContain('อาสาคนที่_11 ทดสอบ');
		expect(text()).toContain('อาสาคนที่_12 ทดสอบ');
		expect(text()).not.toContain('อาสาคนที่_1 ทดสอบ');
		expect(text()).toContain('แสดงหน้าที่ 2 จาก 2');
	});
});
