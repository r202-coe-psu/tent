/**
 * applicant-filter.ts: narrows the applicant board by the tab's filter bar (#849).
 *
 * All filters combine with AND. Pure TypeScript, no I/O, no Svelte. Works on the board
 * `buildApplicantBoard` already built, so the summary counts (taken from the unfiltered
 * board) never move with the filters.
 */

import { applicantAttendance, awaitingAttendanceConfirmation } from './applicant-attendance';
import {
	applicationPerson,
	applicationShiftId,
	type ApplicantBoard,
	type ApplicantHistoryEntry
} from './applicant-board';
import type { ApplicantGroup } from './applicant-queue';
import type { ShiftAssignment } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';
import { matchesVolunteerSearch } from './volunteer-search';

export type ApplicantStatusFilter = 'all' | 'pending' | 'confirmed' | 'declined' | 'staff';
export type ApplicantAttendanceFilter =
	'all' | 'not_checked_in' | 'awaiting_confirmation' | 'working' | 'completed';

/** A resolved shift/date choice: `id` is matched when both sides have one, else `date`. */
export interface ApplicantShiftCriterion {
	id: string | null;
	date: string;
}

export interface ApplicantFilters {
	status: ApplicantStatusFilter;
	shift: ApplicantShiftCriterion | null;
	search: string;
	attendance: ApplicantAttendanceFilter;
}

export const EMPTY_APPLICANT_FILTERS: ApplicantFilters = {
	status: 'all',
	shift: null,
	search: '',
	attendance: 'all'
};

export function hasActiveApplicantFilters(filters: ApplicantFilters): boolean {
	return (
		filters.status !== 'all' ||
		filters.shift !== null ||
		filters.search.trim() !== '' ||
		filters.attendance !== 'all'
	);
}

export interface ApplicantFilterContext {
	assignments: readonly ShiftAssignment[];
	volunteers: ReadonlyMap<string, Volunteer>;
	/** `YYYY-MM-DD` in Asia/Bangkok. */
	today: string;
	/** Decides which ended shifts await attendance confirmation (#885). */
	now: Date;
}

export interface FilteredApplicantBoard {
	pending: ApplicantGroup[];
	history: ApplicantHistoryEntry[];
}

function matchesShift(
	criterion: ApplicantShiftCriterion | null,
	shiftId: string | null | undefined,
	date: string
): boolean {
	if (!criterion) return true;
	return criterion.id && shiftId ? criterion.id === shiftId : criterion.date === date;
}

function bucketOf(assignment: ShiftAssignment, now: Date): ApplicantAttendanceFilter | null {
	switch (assignment.status) {
		case 'assigned':
		case 'standby':
			return awaitingAttendanceConfirmation(assignment, now)
				? 'awaiting_confirmation'
				: 'not_checked_in';
		case 'checked_in':
			return 'working';
		case 'completed':
			return 'completed';
		default:
			return null;
	}
}

function statusAllows(status: ApplicantStatusFilter, entry: ApplicantHistoryEntry): boolean {
	switch (status) {
		case 'all':
			return true;
		case 'pending':
			return false;
		case 'confirmed':
			return entry.facet === 'confirmed';
		case 'declined':
			return entry.facet === 'rejected' || entry.facet === 'cancelled';
		case 'staff':
			return entry.facet === 'staff_assigned';
	}
}

function historyAttendance(
	entry: ApplicantHistoryEntry,
	ctx: ApplicantFilterContext
): ApplicantAttendanceFilter | null {
	if (entry.kind === 'staff') return bucketOf(entry.assignment, ctx.now);
	const state = applicantAttendance(entry.application, ctx.assignments, true, ctx.today);
	return state.kind === 'none' ? null : bucketOf(state.assignment, ctx.now);
}

export function filterApplicantBoard(
	board: Pick<ApplicantBoard, 'pending' | 'history'>,
	filters: ApplicantFilters,
	ctx: ApplicantFilterContext
): FilteredApplicantBoard {
	const query = filters.search.trim();

	// Pending applications are not accepted yet, so they have no attendance to match.
	const keepPending = filters.status === 'all' || filters.status === 'pending';
	const pending =
		keepPending && filters.attendance === 'all'
			? board.pending
					.map((group) => ({
						...group,
						applications: group.applications.filter(
							(a) =>
								matchesShift(filters.shift, applicationShiftId(a), a.selected_shift.date) &&
								matchesVolunteerSearch(applicationPerson(a, ctx.volunteers), query)
						)
					}))
					.filter((group) => group.applications.length > 0)
			: [];

	const history = board.history.filter(
		(entry) =>
			statusAllows(filters.status, entry) &&
			matchesShift(filters.shift, entry.shiftId, entry.date) &&
			matchesVolunteerSearch(entry.person, query) &&
			(filters.attendance === 'all' || historyAttendance(entry, ctx) === filters.attendance)
	);

	return { pending, history };
}
