import { describe, it, expect } from 'vitest';
import {
	buildAssignRoster,
	countAssignable,
	filterAssignRoster,
	shiftKindFor,
	type AssignRosterInput
} from './assign-roster';
import { shiftDutyWindow } from './duty-window';
import type { JobShift } from './job.schema';
import type { ShiftAssignment } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

const DATE = '2026-08-28';

const shift = (over: Partial<JobShift> = {}): JobShift => ({
	id: 'js-target',
	date: DATE,
	end_date: DATE,
	start_time: '08:00',
	end_time: '16:00',
	quota: 4,
	...over
});

const TARGET = shift();
const HEAVY = shift({ id: 'js-heavy', start_time: '09:00', end_time: '15:00' });

let seq = 0;
const volunteer = (over: Partial<Volunteer> = {}): Volunteer =>
	({
		_id: `volunteer:${++seq}`,
		type: 'volunteer',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		created_by: 'test',
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		phone: '0800000000',
		skills: [],
		status: 'active',
		checked_in: false,
		volunteer_code: `V-00${seq}`,
		identity_verified: false,
		source: 'walk_in',
		...over
	}) as Volunteer;

const assignment = (over: Partial<ShiftAssignment> & { volunteer_id: string }): ShiftAssignment =>
	({
		_id: `shift_assignment:${over.volunteer_id}-${over.job_id ?? 'job:target'}`,
		type: 'shift_assignment',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		created_by: 'test',
		job_id: 'job:target',
		date: DATE,
		shift: 'custom',
		station: 'จุดลงทะเบียน',
		duty_window: shiftDutyWindow(TARGET),
		check_in_at: null,
		check_out_at: null,
		check_in_by: null,
		status: 'assigned',
		dispatch_status: null,
		check_in_method: 'qr',
		check_in_reason: null,
		...over
	}) as ShiftAssignment;

const jobsById = new Map([
	['job:target', { title: 'ทีมคัดกรอง', shifts: [TARGET] }],
	['job:heavy', { title: 'ทีมพลาธิการช่วยยกของ', shifts: [HEAVY] }]
]);

function roster(over: Partial<AssignRosterInput> = {}) {
	return buildAssignRoster({
		job: { _id: 'job:target', skills_required: [] },
		shift: TARGET,
		volunteers: [],
		assignments: [],
		jobsById,
		...over
	});
}

describe('buildAssignRoster — row state', () => {
	it('marks a volunteer with no assignment as available and assignable', () => {
		const v = volunteer();
		const [row] = roster({ volunteers: [v] });
		expect(row.state).toEqual({ kind: 'available' });
		expect(row.assignable).toBe(true);
	});

	it('marks an accepted offer on this shift as accepted', () => {
		const v = volunteer();
		const [row] = roster({
			volunteers: [v],
			assignments: [
				assignment({ volunteer_id: v._id, status: 'standby', dispatch_status: 'accepted' })
			]
		});
		expect(row.state).toEqual({ kind: 'accepted' });
		expect(row.assignable).toBe(false);
	});

	it('treats a checked-in / completed row as accepted even without dispatch_status', () => {
		const v1 = volunteer();
		const v2 = volunteer();
		const rows = roster({
			volunteers: [v1, v2],
			assignments: [
				assignment({ volunteer_id: v1._id, status: 'checked_in' }),
				assignment({ volunteer_id: v2._id, status: 'completed' })
			]
		});
		expect(rows.map((r) => r.state.kind)).toEqual(['accepted', 'accepted']);
	});

	it('marks an outstanding offer on this shift as accepted — the back-office roster has no wait-for-response state', () => {
		const v = volunteer();
		const [row] = roster({
			volunteers: [v],
			assignments: [
				assignment({ volunteer_id: v._id, status: 'assigned', dispatch_status: 'dispatched' })
			]
		});
		expect(row.state).toEqual({ kind: 'accepted' });
		expect(row.assignable).toBe(false);
	});

	it('names the clashing job and its wall-clock window on a collision', () => {
		const v = volunteer();
		const [row] = roster({
			volunteers: [v],
			assignments: [
				assignment({
					volunteer_id: v._id,
					job_id: 'job:heavy',
					status: 'standby',
					duty_window: shiftDutyWindow(HEAVY)
				})
			]
		});
		expect(row.state).toEqual({
			kind: 'collision',
			jobTitle: 'ทีมพลาธิการช่วยยกของ',
			startTime: '09:00',
			endTime: '15:00'
		});
		expect(row.assignable).toBe(false);
	});

	it('falls back to a generic label when the clashing job is unknown', () => {
		const v = volunteer();
		const [row] = roster({
			volunteers: [v],
			assignments: [
				assignment({
					volunteer_id: v._id,
					job_id: 'job:deleted',
					status: 'standby',
					duty_window: shiftDutyWindow(HEAVY)
				})
			]
		});
		expect(row.state).toMatchObject({ kind: 'collision', jobTitle: 'ภารกิจอื่น' });
	});

	it('ignores cancelled and no-show rows entirely', () => {
		const v1 = volunteer();
		const v2 = volunteer();
		const rows = roster({
			volunteers: [v1, v2],
			assignments: [
				assignment({ volunteer_id: v1._id, status: 'cancelled', dispatch_status: 'declined' }),
				assignment({
					volunteer_id: v2._id,
					job_id: 'job:heavy',
					status: 'no_show',
					duty_window: shiftDutyWindow(HEAVY)
				})
			]
		});
		expect(rows.map((r) => r.state.kind)).toEqual(['available', 'available']);
	});

	it('does not treat a non-overlapping shift on the same day as a collision', () => {
		const v = volunteer();
		const evening = shift({ id: 'js-pm', start_time: '16:00', end_time: '20:00' });
		const [row] = roster({
			volunteers: [v],
			assignments: [
				assignment({
					volunteer_id: v._id,
					job_id: 'job:heavy',
					status: 'standby',
					duty_window: shiftDutyWindow(evening)
				})
			]
		});
		// The target ends exactly at 16:00 — touching edges don't collide.
		expect(row.state.kind).toBe('available');
	});

	it('throws rather than showing everyone as available when the target shift is malformed', () => {
		expect(() => roster({ shift: shift({ start_time: '25:00' }) })).toThrow();
	});
});

describe('buildAssignRoster — skill match & professional flag', () => {
	it('matches when the volunteer carries any required skill', () => {
		const rows = roster({
			job: { _id: 'job:target', skills_required: ['คัดกรองและสแกนประวัติ'] },
			volunteers: [
				volunteer({ skills: ['คัดกรองและสแกนประวัติ'] }),
				volunteer({ skills: ['ประกอบอาหาร / ครัวสนาม'] })
			]
		});
		expect(rows.map((r) => r.skillMatch)).toEqual([true, false]);
	});

	it('matches everyone when the job requires no skill', () => {
		const rows = roster({ volunteers: [volunteer({ skills: [] })] });
		expect(rows[0].skillMatch).toBe(true);
	});

	it('flags a controlled skill as professional', () => {
		const rows = roster({
			volunteers: [
				volunteer({ skills: ['การแพทย์ / ปฐมพยาบาล'] }),
				volunteer({ skills: ['ประกอบอาหาร / ครัวสนาม'] })
			]
		});
		expect(rows.map((r) => r.professional)).toEqual([true, false]);
	});
});

describe('filterAssignRoster', () => {
	const available = volunteer({
		first_name: 'วิทวัส',
		last_name: 'สอนใจ',
		phone: '0897711223',
		volunteer_code: 'V-003',
		identity_verified: true,
		skills: ['คัดกรองและสแกนประวัติ']
	});
	const unverified = volunteer({
		first_name: 'วรากร',
		last_name: 'ใจดี',
		phone: '0841981118',
		volunteer_code: 'V-8004',
		identity_verified: false,
		skills: ['การแพทย์ / ปฐมพยาบาล']
	});
	const collided = volunteer({
		first_name: 'เก่งกล้า',
		last_name: 'งานอาสา',
		volunteer_code: 'V-001',
		identity_verified: true,
		skills: ['ขนย้ายสิ่งของ / พลาธิการ']
	});

	const rows = () =>
		roster({
			job: { _id: 'job:target', skills_required: ['คัดกรองและสแกนประวัติ'] },
			volunteers: [available, unverified, collided],
			assignments: [
				assignment({
					volunteer_id: collided._id,
					job_id: 'job:heavy',
					status: 'standby',
					duty_window: shiftDutyWindow(HEAVY)
				})
			]
		});

	const codes = (list: ReturnType<typeof rows>) => list.map((r) => r.volunteer.volunteer_code);

	it('returns every row when nothing is filtered', () => {
		expect(codes(filterAssignRoster(rows()))).toEqual(['V-003', 'V-8004', 'V-001']);
	});

	it('searches name, phone and volunteer code', () => {
		expect(codes(filterAssignRoster(rows(), { search: 'สอนใจ' }))).toEqual(['V-003']);
		expect(codes(filterAssignRoster(rows(), { search: '0841981118' }))).toEqual(['V-8004']);
		expect(codes(filterAssignRoster(rows(), { search: 'v-001' }))).toEqual(['V-001']);
		expect(codes(filterAssignRoster(rows(), { search: '  ' }))).toHaveLength(3);
	});

	it('filters by skill match', () => {
		expect(codes(filterAssignRoster(rows(), { skill: 'match' }))).toEqual(['V-003']);
	});

	it('"ready" keeps only assignable rows, "no_collision" only drops clashes', () => {
		expect(codes(filterAssignRoster(rows(), { availability: 'ready' }))).toEqual([
			'V-003',
			'V-8004'
		]);
		expect(codes(filterAssignRoster(rows(), { availability: 'no_collision' }))).toEqual([
			'V-003',
			'V-8004'
		]);
	});

	it('"no_collision" keeps a volunteer already assigned to THIS shift, "ready" does not', () => {
		const list = roster({
			volunteers: [available],
			assignments: [assignment({ volunteer_id: available._id, dispatch_status: 'dispatched' })]
		});
		expect(filterAssignRoster(list, { availability: 'no_collision' })).toHaveLength(1);
		expect(filterAssignRoster(list, { availability: 'ready' })).toHaveLength(0);
	});

	it('filters by identity verification and professional skill', () => {
		expect(codes(filterAssignRoster(rows(), { eligibility: 'verified' }))).toEqual([
			'V-003',
			'V-001'
		]);
		expect(codes(filterAssignRoster(rows(), { eligibility: 'professional' }))).toEqual(['V-8004']);
	});

	it('combines filters', () => {
		expect(
			codes(filterAssignRoster(rows(), { availability: 'ready', eligibility: 'verified' }))
		).toEqual(['V-003']);
	});

	it('countAssignable counts only available rows', () => {
		expect(countAssignable(rows())).toBe(2);
		expect(countAssignable([])).toBe(0);
	});
});

describe('shiftKindFor', () => {
	it('recognises the three standard templates by their UTC window', () => {
		expect(shiftKindFor(shift({ start_time: '08:00', end_time: '16:00' }))).toBe('morning');
		expect(
			shiftKindFor(shift({ start_time: '16:00', end_time: '00:00', end_date: '2026-08-29' }))
		).toBe('afternoon');
		expect(shiftKindFor(shift({ start_time: '00:00', end_time: '08:00' }))).toBe('night');
	});

	it('falls back to custom for any other span', () => {
		expect(shiftKindFor(HEAVY)).toBe('custom');
		expect(shiftKindFor(shift({ start_time: '08:00', end_time: '17:00' }))).toBe('custom');
	});
});
