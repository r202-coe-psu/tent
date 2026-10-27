/**
 * applicant-board.ts: everything the job detail "ผู้สมัคร" tab lists, in one pass.
 *
 * Staff direct assignment (`ShiftAssignmentRepository#assign`) writes a `shift_assignment` with
 * no `job_application`, so the application queue alone never shows those volunteers. Approval
 * also stamps a staff username in `created_by`, so the author cannot tell the two apart. The
 * only signal is that an approval's assignment matches a confirmed application
 * (`assignmentMatchesApplication`); every other assignment of the job is a staff row.
 *
 * Pure TypeScript, no I/O, no Svelte.
 */

import { assignmentMatchesApplication } from './applicant-attendance';
import {
	applicantKey,
	decidedAt,
	groupApplicationsByApplicant,
	partitionApplicantQueue,
	type ApplicantGroup
} from './applicant-queue';
import type { JobApplication } from './job-application.schema';
import type { ShiftAssignment } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

export type HistoryFacet = 'confirmed' | 'rejected' | 'cancelled' | 'staff_assigned';

export interface ApplicantPerson {
	name: string | null;
	phone: string | null;
	code: string | null;
}

interface HistoryBase {
	/** The source document's `_id`. */
	key: string;
	decidedAt: string;
	facet: HistoryFacet;
	/** `volunteer_id`, else `phone:{hash}`: one person across applications and staff rows. */
	personKey: string;
	volunteer: Volunteer | null;
	person: ApplicantPerson;
	shiftId: string | null;
	date: string;
}

export type ApplicantHistoryEntry =
	| (HistoryBase & { kind: 'application'; application: JobApplication })
	| (HistoryBase & { kind: 'staff'; assignment: ShiftAssignment });

export type StaffHistoryEntry = Extract<ApplicantHistoryEntry, { kind: 'staff' }>;

export interface ApplicantBoard {
	pending: ApplicantGroup[];
	/** Newest decision first. */
	history: ApplicantHistoryEntry[];
	counts: {
		people: number;
		pending: number;
		confirmed: number;
		declined: number;
		/** Cancelled staff rows are listed but not counted. */
		staffAssigned: number;
	};
}

/**
 * The assignments of one job that no confirmed application accounts for.
 *
 * A confirmed application claims its cancelled matches, and its live matches only when there
 * is exactly one, because that is the single assignment its row renders (`applicantAttendance`).
 * With two or more live matches its row shows nothing, so they stay unclaimed rather than
 * disappearing from the tab.
 *
 * `jobAssignments` must already be narrowed to the job.
 */
export function staffAssignments(
	confirmed: readonly JobApplication[],
	jobAssignments: readonly ShiftAssignment[]
): ShiftAssignment[] {
	const claimed = new Set<string>();
	for (const application of confirmed) {
		if (application.status !== 'confirmed' || !application.volunteer_id) continue;
		const matches = jobAssignments.filter((a) => assignmentMatchesApplication(application, a));
		const live = matches.filter((a) => a.status !== 'cancelled');
		for (const a of matches) {
			if (a.status === 'cancelled' || live.length === 1) claimed.add(a._id);
		}
	}
	return jobAssignments.filter((a) => !claimed.has(a._id));
}

function applicationEntry(
	application: JobApplication,
	volunteers: ReadonlyMap<string, Volunteer>
): ApplicantHistoryEntry {
	const volunteer = application.volunteer_id
		? (volunteers.get(application.volunteer_id) ?? null)
		: null;
	const { applicant } = application;
	return {
		kind: 'application',
		application,
		key: application._id,
		decidedAt: decidedAt(application),
		facet: application.status as Exclude<HistoryFacet, 'staff_assigned'>,
		personKey: applicantKey(application),
		volunteer,
		person: {
			name: `${applicant.first_name} ${applicant.last_name}`.trim(),
			phone: applicant.phone,
			code: volunteer?.volunteer_code ?? null
		},
		shiftId: application.shift_id ?? application.selected_shift.shift_id ?? null,
		date: application.selected_shift.date
	};
}

function staffEntry(
	assignment: ShiftAssignment,
	volunteers: ReadonlyMap<string, Volunteer>
): ApplicantHistoryEntry {
	const volunteer = volunteers.get(assignment.volunteer_id) ?? null;
	return {
		kind: 'staff',
		assignment,
		key: assignment._id,
		decidedAt: assignment.created_at,
		facet: 'staff_assigned',
		personKey: assignment.volunteer_id,
		volunteer,
		person: volunteer
			? {
					name: `${volunteer.first_name} ${volunteer.last_name}`.trim(),
					phone: volunteer.phone,
					code: volunteer.volunteer_code
				}
			: { name: null, phone: null, code: null },
		shiftId: assignment.shift_id ?? null,
		date: assignment.date
	};
}

export function buildApplicantBoard(input: {
	jobId: string;
	applications: readonly JobApplication[];
	assignments: readonly ShiftAssignment[];
	volunteers: ReadonlyMap<string, Volunteer>;
}): ApplicantBoard {
	const { jobId, volunteers } = input;
	const queue = partitionApplicantQueue(input.applications, jobId);
	const pending = groupApplicationsByApplicant(queue.pending);

	const jobAssignments = input.assignments.filter((a) => a.job_id === jobId);
	const staff = staffAssignments(
		queue.reviewed.filter((a) => a.status === 'confirmed'),
		jobAssignments
	);

	const history = [
		...queue.reviewed.map((a) => applicationEntry(a, volunteers)),
		...staff.map((a) => staffEntry(a, volunteers))
	].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt) || a.key.localeCompare(b.key));

	const people = new Set([...pending.map((g) => g.key), ...history.map((e) => e.personKey)]);

	return {
		pending,
		history,
		counts: {
			people: people.size,
			pending: queue.pending.length,
			confirmed: queue.reviewed.filter((a) => a.status === 'confirmed').length,
			declined: queue.reviewed.filter((a) => a.status === 'rejected' || a.status === 'cancelled')
				.length,
			staffAssigned: staff.filter((a) => a.status !== 'cancelled').length
		}
	};
}

/** Per-facet totals for the history heading, so its shift count reads as a sum (#849). */
export function historyBreakdown(history: readonly Pick<ApplicantHistoryEntry, 'facet'>[]): {
	confirmed: number;
	declined: number;
	staffAssigned: number;
} {
	let confirmed = 0;
	let declined = 0;
	let staffAssigned = 0;
	for (const entry of history) {
		if (entry.facet === 'confirmed') confirmed++;
		else if (entry.facet === 'staff_assigned') staffAssigned++;
		else declined++;
	}
	return { confirmed, declined, staffAssigned };
}
