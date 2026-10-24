import { describe, it, expect } from 'vitest';
import {
	applicantAttendance,
	assignmentAttendance,
	assignmentMatchesApplication
} from './applicant-attendance';
import type { JobApplication } from './job-application.schema';
import type { ShiftAssignment } from './shift-assignment.schema';

const TODAY = '2026-08-10';

function application(overrides: Partial<JobApplication> = {}): JobApplication {
	return {
		_id: 'job_application:1',
		type: 'job_application',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		created_by: 'tester',
		job_id: 'job:A',
		shift_id: 'shift:morning',
		volunteer_id: 'volunteer:1',
		applicant: {
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0812345678',
			phone_hash: 'hash-1',
			email: null,
			skills: [],
			national_id: null
		},
		selected_shift: {
			shift_id: 'shift:morning',
			date: TODAY,
			start_time: '08:00',
			end_time: '16:00'
		},
		tracking_token: 'tok-1',
		status: 'confirmed',
		...overrides
	} as JobApplication;
}

function assignment(overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
	return {
		_id: 'shift_assignment:1',
		type: 'shift_assignment',
		schema_v: 5,
		shelter_code: 'SH001',
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		created_by: 'tester',
		job_id: 'job:A',
		shift_id: 'shift:morning',
		volunteer_id: 'volunteer:1',
		date: TODAY,
		shift: 'morning',
		station: 'ครัวกลาง',
		duty_window: { start_ts: '2026-08-10T01:00:00.000Z', end_ts: '2026-08-10T09:00:00.000Z' },
		status: 'assigned',
		check_in_method: 'qr',
		check_in_reason: null,
		check_out_method: 'qr',
		check_out_reason: null,
		...overrides
	} as ShiftAssignment;
}

describe('applicantAttendance', () => {
	it.each(['pending_review', 'rejected', 'cancelled'] as const)(
		'offers nothing for a %s application',
		(status) => {
			expect(applicantAttendance(application({ status }), [assignment()], true, TODAY)).toEqual({
				kind: 'none'
			});
		}
	);

	it('offers nothing when the application is not linked to a volunteer', () => {
		expect(
			applicantAttendance(application({ volunteer_id: null }), [assignment()], true, TODAY)
		).toEqual({ kind: 'none' });
	});

	it('offers nothing when no assignment matches', () => {
		const other = assignment({ shift_id: 'shift:afternoon' });
		expect(applicantAttendance(application(), [other], true, TODAY)).toEqual({ kind: 'none' });
		expect(applicantAttendance(application(), [], true, TODAY)).toEqual({ kind: 'none' });
	});

	it('ignores assignments of another volunteer or job', () => {
		const others = [
			assignment({ _id: 'shift_assignment:2', volunteer_id: 'volunteer:2' }),
			assignment({ _id: 'shift_assignment:3', job_id: 'job:B' })
		];
		expect(applicantAttendance(application(), others, true, TODAY)).toEqual({ kind: 'none' });
	});

	it('refuses to guess when two assignments match', () => {
		const two = [assignment(), assignment({ _id: 'shift_assignment:2' })];
		expect(applicantAttendance(application(), two, true, TODAY)).toEqual({ kind: 'none' });
	});

	it('ignores a cancelled assignment next to a live one', () => {
		const live = assignment({ _id: 'shift_assignment:2' });
		const cancelled = assignment({ status: 'cancelled' });
		expect(applicantAttendance(application(), [cancelled, live], true, TODAY)).toEqual({
			kind: 'check-in',
			assignment: live
		});
	});

	it('matches by date when the application predates shift ids', () => {
		const legacy = application({
			shift_id: undefined,
			selected_shift: { date: TODAY, start_time: '08:00', end_time: '16:00' }
		});
		const sameDay = assignment({ shift_id: undefined });
		const otherDay = assignment({
			_id: 'shift_assignment:2',
			shift_id: undefined,
			date: '2026-08-11'
		});
		expect(applicantAttendance(legacy, [otherDay, sameDay], true, TODAY)).toEqual({
			kind: 'check-in',
			assignment: sameDay
		});
	});

	it('offers check-in today for a verified volunteer', () => {
		const a = assignment();
		expect(applicantAttendance(application(), [a], true, TODAY)).toEqual({
			kind: 'check-in',
			assignment: a
		});
		const standby = assignment({ status: 'standby' });
		expect(applicantAttendance(application(), [standby], true, TODAY).kind).toBe('check-in');
	});

	it('asks for identity verification today for an unverified volunteer', () => {
		const a = assignment();
		expect(applicantAttendance(application(), [a], false, TODAY)).toEqual({
			kind: 'verify',
			assignment: a
		});
	});

	it('only shows status for a shift on another day, verified or not', () => {
		const tomorrow = assignment({ date: '2026-08-11' });
		expect(applicantAttendance(application(), [tomorrow], true, TODAY).kind).toBe('status');
		expect(applicantAttendance(application(), [tomorrow], false, TODAY).kind).toBe('status');
		const past = assignment({ date: '2026-08-09' });
		expect(applicantAttendance(application(), [past], true, TODAY).kind).toBe('status');
	});

	it('offers check-out for a checked-in volunteer on any date', () => {
		const overnight = assignment({ status: 'checked_in', date: '2026-08-09' });
		expect(applicantAttendance(application(), [overnight], true, TODAY)).toEqual({
			kind: 'check-out',
			assignment: overnight
		});
	});

	it('offers check-out even when identity is not verified', () => {
		const seeded = assignment({ status: 'checked_in' });
		expect(applicantAttendance(application(), [seeded], false, TODAY).kind).toBe('check-out');
	});

	it.each(['completed', 'no_show'] as const)('only shows status for a %s assignment', (status) => {
		const a = assignment({ status });
		expect(applicantAttendance(application(), [a], true, TODAY)).toEqual({
			kind: 'status',
			assignment: a
		});
	});
});

describe('assignmentMatchesApplication', () => {
	it('matches the same job, volunteer and shift id', () => {
		expect(assignmentMatchesApplication(application(), assignment())).toBe(true);
		expect(
			assignmentMatchesApplication(application(), assignment({ shift_id: 'shift:afternoon' }))
		).toBe(false);
	});

	it('rejects another job or volunteer', () => {
		expect(assignmentMatchesApplication(application(), assignment({ job_id: 'job:B' }))).toBe(
			false
		);
		expect(
			assignmentMatchesApplication(application(), assignment({ volunteer_id: 'volunteer:2' }))
		).toBe(false);
	});

	it('ignores status', () => {
		expect(assignmentMatchesApplication(application(), assignment({ status: 'cancelled' }))).toBe(
			true
		);
	});

	it('compares dates when the assignment predates shift ids', () => {
		const legacy = assignment({ shift_id: undefined });
		expect(assignmentMatchesApplication(application(), legacy)).toBe(true);
		expect(assignmentMatchesApplication(application(), { ...legacy, date: '2026-08-11' })).toBe(
			false
		);
	});

	it('compares dates when the application predates shift ids', () => {
		const legacy = application({
			shift_id: undefined,
			selected_shift: { date: TODAY, start_time: '08:00', end_time: '16:00' }
		});
		expect(assignmentMatchesApplication(legacy, assignment())).toBe(true);
		expect(assignmentMatchesApplication(legacy, assignment({ date: '2026-08-11' }))).toBe(false);
	});
});

describe('assignmentAttendance', () => {
	it('only shows status for a cancelled assignment', () => {
		const a = assignment({ status: 'cancelled' });
		expect(assignmentAttendance(a, true, TODAY)).toEqual({ kind: 'status', assignment: a });
	});

	it('offers check-in today only to a verified volunteer', () => {
		const a = assignment();
		expect(assignmentAttendance(a, true, TODAY).kind).toBe('check-in');
		expect(assignmentAttendance(a, false, TODAY).kind).toBe('verify');
	});
});
