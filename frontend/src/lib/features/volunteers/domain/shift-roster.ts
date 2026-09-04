/**
 * shift-roster.ts — which volunteers hold a seat on ONE `job.shifts[]` row.
 *
 * Pure TypeScript — no I/O, no Svelte. New `shift_assignment` rows carry the
 * stable `shift_id`; legacy rows without it are matched by the exact
 * `duty_window` that `job-assign-page.svelte` writes for the selected row.
 */

import { sameDutyWindow, shiftDutyWindow } from './duty-window';
import type { JobShift } from './job.schema';
import type {
	DispatchStatus,
	ShiftAssignment,
	ShiftAssignmentStatus
} from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

export interface ShiftRosterEntry {
	assignmentId: string;
	volunteerId: string;
	volunteerName: string;
	volunteerCode: string;
	status: ShiftAssignmentStatus;
	dispatchStatus: DispatchStatus | null;
	phone: string | null;
	station: string;
	checkInAt: string | null;
	checkOutAt: string | null;
}

/**
 * `cancelled`/`no_show` rows already gave their seat back (or never held
 * one) — they clutter the roster with people who are not actually on this
 * shift, so they are excluded here rather than left for the UI to filter.
 */
const ROSTER_STATUSES: ReadonlySet<ShiftAssignmentStatus> = new Set([
	'assigned',
	'standby',
	'checked_in',
	'completed'
]);

function matchesShift(
	shift: Pick<JobShift, 'id' | 'date' | 'end_date' | 'start_time' | 'end_time'> & {
		shift_id?: string;
	},
	jobId: string,
	assignment: ShiftAssignment,
	window: ReturnType<typeof shiftDutyWindow> | null
): boolean {
	return (
		assignment.job_id === jobId &&
		ROSTER_STATUSES.has(assignment.status) &&
		(assignment.shift_id
			? assignment.shift_id === (shift.shift_id ?? shift.id)
			: window
				? sameDutyWindow(assignment.duty_window, window)
				: false)
	);
}

/** Count unique volunteers holding an active or completed assignment on a shift. */
export function assignmentCountForShift(
	shift: Pick<JobShift, 'id' | 'date' | 'end_date' | 'start_time' | 'end_time'> & {
		shift_id?: string;
	},
	jobId: string,
	assignments: readonly ShiftAssignment[]
): number {
	let window: ReturnType<typeof shiftDutyWindow> | null = null;
	try {
		window = shiftDutyWindow(shift);
	} catch {
		// A stable shift_id can still match even when a legacy row has bad time data.
	}
	return new Set(
		assignments
			.filter((assignment) => matchesShift(shift, jobId, assignment, window))
			.map((assignment) => assignment.volunteer_id)
	).size;
}

/**
 * Volunteers assigned to `shift` (one row of `job.shifts[]`), across every
 * `assignments` doc for `jobId`. Completed rows remain visible so the detail
 * modal is also useful for shift history; cancelled/no-show rows do not.
 *
 * A shift with a malformed date/time (should not happen — `job.shifts[]` is
 * schema-validated on every write — but this is read code, not a write path)
 * falls back to `shift_id`-only matching instead of throwing: rows with a
 * `shift_id` still resolve correctly, and only the legacy duty-window
 * fallback for rows without one comes up empty.
 */
export function shiftRoster(
	shift: Pick<JobShift, 'id' | 'date' | 'end_date' | 'start_time' | 'end_time'> & {
		shift_id?: string;
	},
	jobId: string,
	assignments: readonly ShiftAssignment[],
	volunteersById: ReadonlyMap<
		string,
		Pick<Volunteer, 'first_name' | 'last_name' | 'volunteer_code' | 'phone'>
	>
): ShiftRosterEntry[] {
	let window: ReturnType<typeof shiftDutyWindow> | null = null;
	try {
		window = shiftDutyWindow(shift);
	} catch {
		window = null;
	}

	const matched = assignments.filter((a) => matchesShift(shift, jobId, a, window));
	return [...new Map(matched.map((a) => [a.volunteer_id, a])).values()].map((a) => {
		const volunteer = volunteersById.get(a.volunteer_id);
		return {
			assignmentId: a._id,
			volunteerId: a.volunteer_id,
			volunteerName: volunteer
				? `${volunteer.first_name} ${volunteer.last_name}`
				: 'ไม่พบข้อมูลอาสาสมัคร',
			volunteerCode: volunteer?.volunteer_code ?? '—',
			status: a.status,
			dispatchStatus: a.dispatch_status ?? null,
			phone: volunteer?.phone ?? null,
			station: a.station,
			checkInAt: a.check_in_at ?? null,
			checkOutAt: a.check_out_at ?? null
		};
	});
}

/** Thai label for a roster entry's `status` — used by the shift card's roster list. */
export const SHIFT_ASSIGNMENT_STATUS_LABEL: Record<ShiftAssignmentStatus, string> = {
	assigned: 'มอบหมายแล้ว',
	standby: 'สแตนด์บาย',
	checked_in: 'เช็คอินแล้ว',
	completed: 'ปฏิบัติงานเสร็จแล้ว',
	no_show: 'ไม่มาตามนัด',
	cancelled: 'ยกเลิกแล้ว'
};

/** Thai label for a roster entry's `dispatchStatus` — an outstanding dispatch offer's state. */
export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
	dispatched: 'เสนองานแล้ว รอตอบรับ',
	accepted: 'ตอบรับแล้ว',
	declined: 'ปฏิเสธแล้ว'
};
