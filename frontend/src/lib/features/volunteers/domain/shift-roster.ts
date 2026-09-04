/**
 * shift-roster.ts — which volunteers hold a seat on ONE `job.shifts[]` row.
 *
 * Pure TypeScript — no I/O, no Svelte. `shift_assignment` carries no
 * `job_shift_id` (schema.md §2.9 gap — same one `domain/capacity.ts`
 * documents), but `job-assign-page.svelte` always writes `duty_window:
 * shiftDutyWindow(shift)` for the exact row being assigned. Recomputing that
 * window here and comparing it with `sameDutyWindow` is therefore an EXACT
 * match, not the best-guess allocation `capacity.ts` falls back to for
 * aggregate counts.
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
	'checked_in'
]);

/**
 * Volunteers currently on `shift` (one row of `job.shifts[]`), across every
 * `assignments` doc for `jobId`.
 *
 * A shift with a malformed date/time (should not happen — `job.shifts[]` is
 * schema-validated on every write — but this is read code, not a write path)
 * returns an empty roster rather than throwing, since a broken row simply has
 * no assignments that could possibly match it.
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
	let window: ReturnType<typeof shiftDutyWindow>;
	try {
		window = shiftDutyWindow(shift);
	} catch {
		return [];
	}

	const matched = assignments.filter(
		(a) =>
			a.job_id === jobId &&
			ROSTER_STATUSES.has(a.status) &&
			(a.shift_id
				? a.shift_id === (shift.shift_id ?? shift.id)
				: sameDutyWindow(a.duty_window, window))
	);
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
