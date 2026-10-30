/**
 * What the job detail "ผู้สมัคร" tab offers staff on one approved application row:
 * check the volunteer in or out of the matching `shift_assignment`, or just show where
 * that assignment stands. Pure — the row renders by `kind`.
 *
 * Approval creates the assignment (`JobApplicationRepository#assignmentFor`), so this
 * matches an application back to it by the same rule. When that is ambiguous we show
 * nothing rather than guess which shift to check someone into.
 */
import type { JobApplication } from './job-application.schema';
import type { ShiftAssignment } from './shift-assignment.schema';

export type ApplicantAttendance =
	| { kind: 'none' }
	| { kind: 'status'; assignment: ShiftAssignment }
	| { kind: 'verify'; assignment: ShiftAssignment }
	| { kind: 'check-in'; assignment: ShiftAssignment }
	| { kind: 'check-out'; assignment: ShiftAssignment };

const NONE: ApplicantAttendance = { kind: 'none' };

/**
 * Whether `assignment` is the one approving `application` creates
 * (`JobApplicationRepository#assignmentFor`). Ignores status. Shift ids decide when both
 * sides have one; a legacy row on either side falls back to the shift's calendar date.
 */
export function assignmentMatchesApplication(
	application: JobApplication,
	assignment: ShiftAssignment
): boolean {
	if (
		assignment.job_id !== application.job_id ||
		assignment.volunteer_id !== application.volunteer_id
	) {
		return false;
	}
	const shiftId = application.shift_id ?? application.selected_shift.shift_id;
	return shiftId && assignment.shift_id
		? assignment.shift_id === shiftId
		: assignment.date === application.selected_shift.date;
}

/**
 * `today` is `YYYY-MM-DD` in Asia/Bangkok. Only `checked_in` ignores it: an overnight shift
 * is still open on the next calendar day and must stay checkable-out.
 */
export function assignmentAttendance(
	assignment: ShiftAssignment,
	identityVerified: boolean,
	today: string
): ApplicantAttendance {
	switch (assignment.status) {
		case 'checked_in':
			return { kind: 'check-out', assignment };
		case 'assigned':
		case 'standby':
			if (assignment.date !== today) return { kind: 'status', assignment };
			return { kind: identityVerified ? 'check-in' : 'verify', assignment };
		default:
			return { kind: 'status', assignment };
	}
}

export function applicantAttendance(
	application: JobApplication,
	assignments: readonly ShiftAssignment[],
	identityVerified: boolean,
	today: string
): ApplicantAttendance {
	if (application.status !== 'confirmed' || !application.volunteer_id) return NONE;

	const live = assignments.filter(
		(a) => assignmentMatchesApplication(application, a) && a.status !== 'cancelled'
	);
	return live.length === 1 ? assignmentAttendance(live[0], identityVerified, today) : NONE;
}

/** #849 (CR-207 FR-1) — minutes after a shift ends before an unchecked-in `assigned` or accepted `standby` row needs staff to confirm. */
export const ATTENDANCE_CONFIRM_AFTER_MINUTES = 30;

/**
 * #849 (CR-207 FR-1): the shift ended at least `ATTENDANCE_CONFIRM_AFTER_MINUTES` ago and nobody
 * checked the volunteer in, so staff should confirm whether they came. Computed at render
 * time, never stored. `flex` (standby) has no end and is never awaiting confirmation.
 */
export function awaitingAttendanceConfirmation(assignment: ShiftAssignment, now: Date): boolean {
	if (assignment.shift === 'flex') return false;
	// Accepted shifts are written as `standby` + `dispatch_status: 'accepted'` (assign / public apply).
	const open =
		assignment.status === 'assigned' ||
		(assignment.status === 'standby' && assignment.dispatch_status === 'accepted');
	if (!open) return false;
	const end = Date.parse(assignment.duty_window?.end_ts ?? '');
	return Number.isFinite(end) && now.getTime() >= end + ATTENDANCE_CONFIRM_AFTER_MINUTES * 60_000;
}
