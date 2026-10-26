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
 * `today` is `YYYY-MM-DD` in Asia/Bangkok. Only `checked_in` ignores it: an overnight shift
 * is still open on the next calendar day and must stay checkable-out.
 */
export function applicantAttendance(
	application: JobApplication,
	assignments: readonly ShiftAssignment[],
	identityVerified: boolean,
	today: string
): ApplicantAttendance {
	if (application.status !== 'confirmed' || !application.volunteer_id) return NONE;

	const shiftId = application.shift_id ?? application.selected_shift.shift_id;
	const matches = assignments.filter(
		(a) =>
			a.job_id === application.job_id &&
			a.volunteer_id === application.volunteer_id &&
			a.status !== 'cancelled' &&
			(shiftId ? a.shift_id === shiftId : a.date === application.selected_shift.date)
	);
	if (matches.length !== 1) return NONE;

	const assignment = matches[0];
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
