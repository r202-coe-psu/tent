import { describe, it, expect } from 'vitest';
import {
	activeAssignmentCountForShift,
	assignmentCountForJob,
	assignmentCountForShift,
	jobQuotaUsageFromAssignments,
	shiftRoster
} from './shift-roster';
import { shiftDutyWindow } from './duty-window';
import type { ShiftAssignment, ShiftAssignmentStatus } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

const SHIFT = {
	id: 'shift:morning',
	date: '2026-06-13',
	end_date: '2026-06-13',
	start_time: '08:00',
	end_time: '16:00'
};
const OTHER_SHIFT = {
	date: '2026-06-13',
	end_date: '2026-06-14',
	start_time: '16:00',
	end_time: '00:00'
};

function assignment(overrides: Partial<ShiftAssignment> & { _id: string }): ShiftAssignment {
	return {
		type: 'shift_assignment',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: '2026-06-01T00:00:00.000Z',
		updated_at: '2026-06-01T00:00:00.000Z',
		created_by: 'tester',
		job_id: 'job:A',
		volunteer_id: 'volunteer:1',
		date: SHIFT.date,
		shift: 'morning',
		station: 'ครัวกลาง',
		duty_window: shiftDutyWindow(SHIFT),
		status: 'assigned',
		dispatch_status: 'accepted',
		check_in_method: 'qr',
		check_in_reason: null,
		...overrides
	} as ShiftAssignment;
}

function volunteersById(
	entries: [string, Pick<Volunteer, 'first_name' | 'last_name' | 'volunteer_code' | 'phone'>][]
) {
	return new Map(entries);
}

describe('shiftRoster', () => {
	it('counts unique people holding the exact shift for assignment capacity', () => {
		const count = assignmentCountForShift(SHIFT, 'job:A', [
			assignment({ _id: 'a:1', volunteer_id: 'volunteer:1', status: 'standby' }),
			assignment({ _id: 'a:2', volunteer_id: 'volunteer:1', status: 'checked_in' }),
			assignment({ _id: 'a:3', volunteer_id: 'volunteer:2', status: 'completed' }),
			assignment({
				_id: 'a:4',
				volunteer_id: 'volunteer:3',
				job_id: 'job:B'
			}),
			assignment({ _id: 'a:5', volunteer_id: 'volunteer:4', status: 'cancelled' })
		]);

		expect(count).toBe(2);
	});

	it('separates live capacity from completed history when rebuilding job quota', () => {
		const secondShift = { ...SHIFT, id: 'shift:B', start_time: '16:00', end_time: '20:00' };
		const assignments = [
			assignment({ _id: 'a:1', volunteer_id: 'volunteer:1', status: 'standby' }),
			assignment({ _id: 'a:2', volunteer_id: 'volunteer:2', status: 'checked_in' }),
			assignment({ _id: 'a:3', volunteer_id: 'volunteer:3', status: 'completed' }),
			assignment({
				_id: 'a:4',
				volunteer_id: 'volunteer:4',
				shift_id: secondShift.id,
				status: 'standby',
				dispatch_status: 'dispatched',
				duty_window: shiftDutyWindow(secondShift)
			}),
			assignment({ _id: 'a:5', volunteer_id: 'volunteer:5', status: 'cancelled' })
		];

		expect(activeAssignmentCountForShift(SHIFT, 'job:A', assignments)).toBe(2);
		expect(
			jobQuotaUsageFromAssignments({ _id: 'job:A', shifts: [SHIFT, secondShift] }, assignments)
		).toEqual({ confirmed: 2, dispatched: 1 });
	});

	it('sums seats across a job from each concrete shift roster', () => {
		const secondShift = { ...SHIFT, id: 'shift:B', start_time: '16:00', end_time: '20:00' };
		const count = assignmentCountForJob({ _id: 'job:A', shifts: [SHIFT, secondShift] }, [
			assignment({ _id: 'a:1', volunteer_id: 'volunteer:1' }),
			assignment({
				_id: 'a:2',
				volunteer_id: 'volunteer:2',
				shift_id: secondShift.id,
				duty_window: shiftDutyWindow(secondShift)
			})
		]);

		expect(count).toBe(2);
	});

	it('matches assignments whose duty_window equals the shift, by exact instant', () => {
		const roster = shiftRoster(
			SHIFT,
			'job:A',
			[assignment({ _id: 'a:1', volunteer_id: 'volunteer:1' })],
			volunteersById([
				[
					'volunteer:1',
					{ first_name: 'สมชาย', last_name: 'ใจดี', volunteer_code: 'V-001', phone: '0812345678' }
				]
			])
		);
		expect(roster).toEqual([
			{
				assignmentId: 'a:1',
				volunteerId: 'volunteer:1',
				volunteerName: 'สมชาย ใจดี',
				volunteerCode: 'V-001',
				status: 'assigned',
				dispatchStatus: 'accepted',
				phone: '0812345678',
				station: 'ครัวกลาง',
				checkInAt: null,
				checkOutAt: null
			}
		]);
	});

	it('excludes assignments for a different job even with the same window', () => {
		const roster = shiftRoster(
			SHIFT,
			'job:A',
			[assignment({ _id: 'a:1', job_id: 'job:B' })],
			volunteersById([])
		);
		expect(roster).toEqual([]);
	});

	it('excludes assignments on a different sub-shift of the same job', () => {
		const roster = shiftRoster(
			SHIFT,
			'job:A',
			[assignment({ _id: 'a:1', duty_window: shiftDutyWindow(OTHER_SHIFT) })],
			volunteersById([])
		);
		expect(roster).toEqual([]);
	});

	it.each<ShiftAssignmentStatus>(['cancelled', 'no_show'])(
		'excludes %s assignments — they no longer hold a seat',
		(status) => {
			const roster = shiftRoster(
				SHIFT,
				'job:A',
				[assignment({ _id: 'a:1', status })],
				volunteersById([])
			);
			expect(roster).toEqual([]);
		}
	);

	it.each<ShiftAssignmentStatus>(['assigned', 'standby', 'checked_in'])(
		'includes %s assignments — they currently hold a seat',
		(status) => {
			const roster = shiftRoster(
				SHIFT,
				'job:A',
				[assignment({ _id: 'a:1', status })],
				volunteersById([])
			);
			expect(roster).toHaveLength(1);
		}
	);

	it('includes completed assignments so the shift history modal shows everyone who worked', () => {
		const roster = shiftRoster(
			SHIFT,
			'job:A',
			[assignment({ _id: 'a:1', status: 'completed' })],
			volunteersById([])
		);
		expect(roster).toHaveLength(1);
	});

	it('uses shift_id when two sub-shifts share the same duty window', () => {
		const roster = shiftRoster(
			{ ...SHIFT, shift_id: 'shift:morning' },
			'job:A',
			[
				assignment({ _id: 'a:1', shift_id: 'shift:morning' }),
				assignment({ _id: 'a:2', shift_id: 'shift:afternoon', volunteer_id: 'volunteer:2' })
			],
			volunteersById([])
		);
		expect(roster.map((entry) => entry.assignmentId)).toEqual(['a:1']);
	});

	it('deduplicates active assignment rows by volunteer', () => {
		const roster = shiftRoster(
			{ ...SHIFT, shift_id: 'shift:morning' },
			'job:A',
			[
				assignment({ _id: 'a:1', shift_id: 'shift:morning' }),
				assignment({ _id: 'a:2', shift_id: 'shift:morning' })
			],
			volunteersById([])
		);
		expect(roster).toHaveLength(1);
	});

	it('falls back to a placeholder name when the volunteer cannot be found', () => {
		const roster = shiftRoster(SHIFT, 'job:A', [assignment({ _id: 'a:1' })], volunteersById([]));
		expect(roster[0]).toMatchObject({ volunteerName: 'ไม่พบข้อมูลอาสาสมัคร', volunteerCode: '—' });
	});

	it('returns an empty roster for a shift with a malformed time instead of throwing', () => {
		const broken = { ...SHIFT, start_time: '25:00' };
		expect(() =>
			shiftRoster(broken, 'job:A', [assignment({ _id: 'a:1' })], volunteersById([]))
		).not.toThrow();
		expect(shiftRoster(broken, 'job:A', [assignment({ _id: 'a:1' })], volunteersById([]))).toEqual(
			[]
		);
	});

	it('keeps identity-linked assignments when the shift time snapshot is malformed', () => {
		const broken = { ...SHIFT, start_time: '25:00', shift_id: 'shift:morning' };
		const roster = shiftRoster(
			broken,
			'job:A',
			[assignment({ _id: 'a:1', shift_id: 'shift:morning' })],
			volunteersById([])
		);
		expect(roster).toHaveLength(1);
	});
});
