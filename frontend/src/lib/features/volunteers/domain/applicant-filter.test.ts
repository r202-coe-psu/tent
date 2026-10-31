import { describe, it, expect } from 'vitest';
import { buildApplicantBoard } from './applicant-board';
import {
	EMPTY_APPLICANT_FILTERS,
	filterApplicantBoard,
	hasActiveApplicantFilters,
	type ApplicantFilters
} from './applicant-filter';
import type { JobApplication } from './job-application.schema';
import type { ShiftAssignment } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

const JOB = 'job:A';
const TODAY = '2026-08-10';

function application(n: number, overrides: Partial<JobApplication> = {}): JobApplication {
	const shiftId = overrides.shift_id ?? 'shift:today';
	return {
		_id: `job_application:${n}`,
		type: 'job_application',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: `2026-08-01T00:00:0${n}.000Z`,
		updated_at: `2026-08-01T00:00:0${n}.000Z`,
		created_by: 'tester',
		job_id: JOB,
		shift_id: shiftId,
		volunteer_id: `volunteer:${n}`,
		applicant: {
			first_name: `ชื่อ${n}`,
			last_name: `สกุล${n}`,
			phone: `081000000${n}`,
			phone_hash: `hash-${n}`,
			email: null,
			skills: [],
			national_id: null
		},
		selected_shift: {
			shift_id: shiftId,
			date: shiftId === 'shift:today' ? TODAY : '2026-08-11',
			start_time: '08:00',
			end_time: '16:00'
		},
		tracking_token: `tok-${n}`,
		status: 'pending_review',
		reviewed_at: null,
		...overrides
	} as JobApplication;
}

function assignment(n: number, overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
	return {
		_id: `shift_assignment:${n}`,
		type: 'shift_assignment',
		schema_v: 5,
		shelter_code: 'SH001',
		created_at: '2026-08-01T12:00:00.000Z',
		updated_at: '2026-08-01T12:00:00.000Z',
		created_by: 'staff1',
		job_id: JOB,
		shift_id: 'shift:today',
		volunteer_id: `volunteer:${n}`,
		date: TODAY,
		shift: 'morning',
		status: 'assigned',
		...overrides
	} as ShiftAssignment;
}

const volunteers = new Map<string, Volunteer>(
	[1, 2, 3, 4, 5, 6].map((n) => [
		`volunteer:${n}`,
		{
			_id: `volunteer:${n}`,
			type: 'volunteer',
			first_name: `ชื่อ${n}`,
			last_name: `สกุล${n}`,
			phone: `081000000${n}`,
			volunteer_code: `V-00${n}`
		} as Volunteer
	])
);

// 1: pending today, 2: pending tomorrow, 3: confirmed today (checked in),
// 4: rejected tomorrow, 5: staff row today (assigned), 6: staff row tomorrow (completed)
const applications = [
	application(1),
	application(2, { shift_id: 'shift:tomorrow' }),
	application(3, { status: 'confirmed', reviewed_at: '2026-08-02T00:00:00.000Z' }),
	application(4, {
		shift_id: 'shift:tomorrow',
		status: 'rejected',
		reviewed_at: '2026-08-03T00:00:00.000Z'
	})
];
const assignments = [
	assignment(3, { status: 'checked_in' }),
	assignment(5),
	assignment(6, { shift_id: 'shift:tomorrow', date: '2026-08-11', status: 'completed' })
];

const board = buildApplicantBoard({ jobId: JOB, applications, assignments, volunteers });
// 12:00 Bangkok on TODAY: no fixture shift has ended yet.
const ctx = { assignments, volunteers, today: TODAY, now: new Date('2026-08-10T05:00:00.000Z') };

function run(patch: Partial<ApplicantFilters>) {
	const result = filterApplicantBoard(board, { ...EMPTY_APPLICANT_FILTERS, ...patch }, ctx);
	return {
		pending: result.pending.flatMap((g) => g.applications.map((a) => a._id)),
		history: result.history.map((e) => e.key).sort()
	};
}

const app = (n: number) => `job_application:${n}`;
const asg = (n: number) => `shift_assignment:${n}`;

describe('filterApplicantBoard', () => {
	it('keeps everything with no filters', () => {
		const r = run({});
		expect(r.pending).toEqual([app(1), app(2)]);
		expect(r.history).toEqual([app(3), app(4), asg(5), asg(6)].sort());
	});

	it('filters by status', () => {
		expect(run({ status: 'pending' })).toEqual({ pending: [app(1), app(2)], history: [] });
		expect(run({ status: 'confirmed' })).toEqual({ pending: [], history: [app(3)] });
		expect(run({ status: 'declined' })).toEqual({ pending: [], history: [app(4)] });
		expect(run({ status: 'staff' })).toEqual({ pending: [], history: [asg(5), asg(6)] });
	});

	it('filters by shift id', () => {
		const r = run({ shift: { id: 'shift:tomorrow', date: '2026-08-11' } });
		expect(r.pending).toEqual([app(2)]);
		expect(r.history).toEqual([app(4), asg(6)]);
	});

	it('filters by date alone (the today option)', () => {
		const r = run({ shift: { id: null, date: TODAY } });
		expect(r.pending).toEqual([app(1)]);
		expect(r.history).toEqual([app(3), asg(5)]);
	});

	it('falls back to the date when a row has no shift id', () => {
		const legacy = application(1);
		delete legacy.shift_id;
		delete legacy.selected_shift.shift_id;
		const b = buildApplicantBoard({
			jobId: JOB,
			applications: [legacy],
			assignments: [],
			volunteers
		});
		const r = filterApplicantBoard(
			b,
			{ ...EMPTY_APPLICANT_FILTERS, shift: { id: 'shift:today', date: TODAY } },
			ctx
		);
		expect(r.pending).toHaveLength(1);
	});

	it('shows only the matching shifts inside a multi-shift pending card', () => {
		const multi = [
			application(1),
			application(1, { _id: 'job_application:1b', shift_id: 'shift:tomorrow' })
		];
		const b = buildApplicantBoard({ jobId: JOB, applications: multi, assignments: [], volunteers });
		expect(b.pending).toHaveLength(1);
		const r = filterApplicantBoard(
			b,
			{ ...EMPTY_APPLICANT_FILTERS, shift: { id: 'shift:tomorrow', date: '2026-08-11' } },
			ctx
		);
		expect(r.pending).toHaveLength(1);
		expect(r.pending[0].applications.map((a) => a._id)).toEqual(['job_application:1b']);
	});

	it('searches name, phone and code, case-insensitively and trimmed', () => {
		expect(run({ search: '  ชื่อ3 ' }).history).toEqual([app(3)]);
		expect(run({ search: 'สกุล1' }).pending).toEqual([app(1)]);
		expect(run({ search: '0810000005' }).history).toEqual([asg(5)]);
		expect(run({ search: '081-000-0005' }).history).toEqual([asg(5)]);
		expect(run({ search: 'v-006' }).history).toEqual([asg(6)]);
		expect(run({ search: 'v-001' }).pending).toEqual([app(1)]);
		expect(run({ search: 'nobody' })).toEqual({ pending: [], history: [] });
	});

	it.each(['v006', 'V006', 'v-006', 'V 006'])(
		'finds V-006 when searched as %s (#1013)',
		(search) => {
			expect(run({ search }).history).toEqual([asg(6)]);
		}
	);

	it('finds a pending application by a code typed without the dash (#1013)', () => {
		expect(run({ search: 'v001' }).pending).toEqual([app(1)]);
	});

	it('does not match every code on a lone dash (#1013)', () => {
		// A lone dash compacts to nothing, so the code path never matches; names and phones in
		// this fixture have no dash either, so nothing matches. A name or phone that contains a
		// dash would still match on its own path.
		expect(run({ search: '-' })).toEqual({ pending: [], history: [] });
	});

	it('filters by attendance over accepted shifts only', () => {
		expect(run({ attendance: 'working' })).toEqual({ pending: [], history: [app(3)] });
		expect(run({ attendance: 'not_checked_in' })).toEqual({ pending: [], history: [asg(5)] });
		expect(run({ attendance: 'completed' })).toEqual({ pending: [], history: [asg(6)] });
	});

	it('moves an assigned shift ended 30+ minutes ago to awaiting confirmation (#885)', () => {
		const ended = assignment(5, {
			duty_window: { start_ts: '2026-08-10T01:00:00.000Z', end_ts: '2026-08-10T09:00:00.000Z' }
		});
		const withEnded = [assignments[0], ended, assignments[2]];
		const b = buildApplicantBoard({ jobId: JOB, applications, assignments: withEnded, volunteers });
		const at = (iso: string, attendance: ApplicantFilters['attendance']) =>
			filterApplicantBoard(
				b,
				{ ...EMPTY_APPLICANT_FILTERS, attendance },
				{ ...ctx, assignments: withEnded, now: new Date(iso) }
			).history.map((e) => e.key);

		expect(at('2026-08-10T09:29:59.000Z', 'awaiting_confirmation')).toEqual([]);
		expect(at('2026-08-10T09:29:59.000Z', 'not_checked_in')).toEqual([asg(5)]);
		expect(at('2026-08-10T09:30:00.000Z', 'awaiting_confirmation')).toEqual([asg(5)]);
		expect(at('2026-08-10T09:30:00.000Z', 'not_checked_in')).toEqual([]);
	});

	it('files a cancelled direct assignment under declined, not staff (#849)', () => {
		const withCancelled = [
			...assignments,
			assignment(5, { _id: 'shift_assignment:5c', status: 'cancelled' })
		];
		const b = buildApplicantBoard({
			jobId: JOB,
			applications,
			assignments: withCancelled,
			volunteers
		});
		const keys = (status: ApplicantFilters['status']) =>
			filterApplicantBoard(b, { ...EMPTY_APPLICANT_FILTERS, status }, ctx).history.map(
				(e) => e.key
			);
		expect(keys('staff')).not.toContain('shift_assignment:5c');
		expect(keys('declined')).toContain('shift_assignment:5c');
		expect(b.counts.staffAssigned).toBe(keys('staff').length);
	});

	it('combines filters with AND', () => {
		expect(run({ status: 'staff', shift: { id: null, date: TODAY } })).toEqual({
			pending: [],
			history: [asg(5)]
		});
		expect(run({ attendance: 'working', search: 'ชื่อ5' })).toEqual({ pending: [], history: [] });
		expect(run({ status: 'pending', search: 'ชื่อ2', shift: { id: null, date: TODAY } })).toEqual({
			pending: [],
			history: []
		});
	});

	it('does not touch the unfiltered board counts', () => {
		run({ status: 'staff' });
		expect(board.counts).toMatchObject({ pending: 2, confirmed: 1, declined: 1, staffAssigned: 2 });
	});
});

describe('hasActiveApplicantFilters', () => {
	it('is false for the empty filters and for a blank search', () => {
		expect(hasActiveApplicantFilters(EMPTY_APPLICANT_FILTERS)).toBe(false);
		expect(hasActiveApplicantFilters({ ...EMPTY_APPLICANT_FILTERS, search: '  ' })).toBe(false);
	});
	it('is true when any filter is set', () => {
		expect(hasActiveApplicantFilters({ ...EMPTY_APPLICANT_FILTERS, status: 'pending' })).toBe(true);
		expect(hasActiveApplicantFilters({ ...EMPTY_APPLICANT_FILTERS, search: 'a' })).toBe(true);
	});
});
