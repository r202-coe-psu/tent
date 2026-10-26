import { describe, it, expect } from 'vitest';
import { buildApplicantBoard } from './applicant-board';
import type { JobApplication } from './job-application.schema';
import type { ShiftAssignment } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

const JOB = 'job:A';

function application(overrides: Partial<JobApplication> = {}): JobApplication {
	return {
		_id: 'job_application:1',
		type: 'job_application',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		created_by: 'tester',
		job_id: JOB,
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
			date: '2026-08-10',
			start_time: '08:00',
			end_time: '16:00'
		},
		tracking_token: 'tok-1',
		status: 'confirmed',
		reviewed_at: '2026-08-02T00:00:00.000Z',
		...overrides
	} as JobApplication;
}

function assignment(overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
	return {
		_id: 'shift_assignment:1',
		type: 'shift_assignment',
		schema_v: 5,
		shelter_code: 'SH001',
		created_at: '2026-08-01T12:00:00.000Z',
		updated_at: '2026-08-01T12:00:00.000Z',
		created_by: 'staff1',
		job_id: JOB,
		shift_id: 'shift:morning',
		volunteer_id: 'volunteer:1',
		date: '2026-08-10',
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

function volunteer(id: string, overrides: Partial<Volunteer> = {}): Volunteer {
	return {
		_id: id,
		type: 'volunteer',
		first_name: 'วิภา',
		last_name: 'สุขสม',
		phone: '0899999999',
		volunteer_code: `V-${id.slice(-1)}`,
		...overrides
	} as Volunteer;
}

const volunteers = new Map([
	['volunteer:1', volunteer('volunteer:1')],
	['volunteer:2', volunteer('volunteer:2')]
]);

function board(input: { applications?: JobApplication[]; assignments?: ShiftAssignment[] }) {
	return buildApplicantBoard({
		jobId: JOB,
		applications: input.applications ?? [],
		assignments: input.assignments ?? [],
		volunteers
	});
}

const staffRows = (b: ReturnType<typeof board>) => b.history.filter((e) => e.kind === 'staff');

describe('buildApplicantBoard', () => {
	it('lists a confirmed application once, with no staff row for its own assignment', () => {
		const b = board({ applications: [application()], assignments: [assignment()] });
		expect(b.history.map((e) => e.kind)).toEqual(['application']);
		expect(b.counts).toMatchObject({ people: 1, confirmed: 1, staffAssigned: 0 });
	});

	it('surfaces a direct assignment on a shift whose application was rejected', () => {
		const rejected = application({ status: 'rejected' });
		const direct = assignment();
		const b = board({ applications: [rejected], assignments: [direct] });
		expect(staffRows(b).map((e) => e.key)).toEqual([direct._id]);
		expect(b.counts).toMatchObject({ declined: 1, staffAssigned: 1, people: 1 });
	});

	it('lists a cancelled direct assignment without counting it', () => {
		const cancelled = assignment({ status: 'cancelled' });
		const b = board({ assignments: [cancelled] });
		expect(staffRows(b).map((e) => e.key)).toEqual([cancelled._id]);
		expect(b.counts.staffAssigned).toBe(0);
		expect(b.counts.people).toBe(1);
	});

	it('shows both assignments of an ambiguous confirmed application as staff rows', () => {
		const legacy = application({
			shift_id: undefined,
			selected_shift: { date: '2026-08-10', start_time: '08:00', end_time: '16:00' }
		});
		const first = assignment({ _id: 'shift_assignment:1', shift_id: undefined });
		const second = assignment({ _id: 'shift_assignment:2', shift_id: undefined });
		const b = board({ applications: [legacy], assignments: [first, second] });
		expect(
			staffRows(b)
				.map((e) => e.key)
				.sort()
		).toEqual([first._id, second._id]);
		expect(b.counts.staffAssigned).toBe(2);
	});

	it('claims a re-assignment that replaced a cancelled approval assignment', () => {
		const approval = assignment({ _id: 'shift_assignment:1', status: 'cancelled' });
		const replacement = assignment({ _id: 'shift_assignment:2' });
		const b = board({ applications: [application()], assignments: [approval, replacement] });
		expect(staffRows(b)).toEqual([]);
		expect(b.counts.staffAssigned).toBe(0);
	});

	it('gives each shift of one directly assigned volunteer its own row', () => {
		const rows = ['shift:morning', 'shift:afternoon', 'shift:night'].map((shift_id, i) =>
			assignment({ _id: `shift_assignment:${i + 1}`, shift_id })
		);
		const b = board({ assignments: rows });
		expect(staffRows(b)).toHaveLength(3);
		expect(b.counts).toMatchObject({ people: 1, staffAssigned: 3 });
	});

	it('counts one person once across an application and a staff assignment', () => {
		const b = board({
			applications: [application({ status: 'rejected' })],
			assignments: [assignment({ _id: 'shift_assignment:9', shift_id: 'shift:afternoon' })]
		});
		expect(b.counts.people).toBe(1);
	});

	it('still emits a staff row when the volunteer profile is missing', () => {
		const b = board({ assignments: [assignment({ volunteer_id: 'volunteer:404' })] });
		expect(b.history).toHaveLength(1);
		expect(b.history[0]).toMatchObject({
			kind: 'staff',
			volunteer: null,
			person: { name: null, phone: null, code: null }
		});
	});

	it('takes the staff row person from the volunteer profile', () => {
		const b = board({ assignments: [assignment({ volunteer_id: 'volunteer:2' })] });
		expect(b.history[0].person).toEqual({
			name: 'วิภา สุขสม',
			phone: '0899999999',
			code: 'V-2'
		});
	});

	it('orders history newest decision first, breaking ties by key', () => {
		const old = application({
			_id: 'job_application:old',
			reviewed_at: '2026-08-01T00:00:00.000Z'
		});
		const mid = assignment({
			_id: 'shift_assignment:mid',
			volunteer_id: 'volunteer:2',
			created_at: '2026-08-03T00:00:00.000Z'
		});
		const tieB = application({
			_id: 'job_application:b',
			status: 'rejected',
			volunteer_id: null,
			reviewed_at: '2026-08-05T00:00:00.000Z'
		});
		const tieA = application({
			_id: 'job_application:a',
			status: 'rejected',
			volunteer_id: null,
			reviewed_at: '2026-08-05T00:00:00.000Z'
		});
		const b = board({ applications: [old, tieB, tieA], assignments: [mid] });
		expect(b.history.map((e) => e.key)).toEqual([
			'job_application:a',
			'job_application:b',
			'shift_assignment:mid',
			'job_application:old'
		]);
	});

	it('ignores assignments and applications of other jobs', () => {
		const b = board({
			applications: [application({ job_id: 'job:B' })],
			assignments: [assignment({ job_id: 'job:B' })]
		});
		expect(b.history).toEqual([]);
		expect(b.counts).toEqual({
			people: 0,
			pending: 0,
			confirmed: 0,
			declined: 0,
			staffAssigned: 0
		});
	});

	it('keeps pending applications in the queue, grouped per person, not in history', () => {
		const b = board({
			applications: [
				application({ _id: 'job_application:p1', status: 'pending_review', reviewed_at: null }),
				application({
					_id: 'job_application:p2',
					status: 'pending_review',
					reviewed_at: null,
					shift_id: 'shift:afternoon'
				})
			]
		});
		expect(b.pending).toHaveLength(1);
		expect(b.pending[0].applications).toHaveLength(2);
		expect(b.history).toEqual([]);
		expect(b.counts).toMatchObject({ people: 1, pending: 2 });
	});
});
