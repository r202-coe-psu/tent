/**
 * Assigning volunteers to several shifts of one job in a single go (#1164). Pure: it decides which
 * (shift, volunteer) pairs go through and why the rest do not, with the rules the single-shift
 * roster already applies (`buildAssignRoster`: already on the shift, clash with another
 * assignment's time) plus each shift's free seats. A pair that cannot go through is skipped and
 * reported; the others are still saved.
 */
import { assignmentCountForShift } from './shift-roster';
import { buildAssignRoster, shiftKindFor, type AssignRosterInput } from './assign-roster';
import { shiftDutyWindow } from './duty-window';
import type { JobShift } from './job.schema';
import type { DutyWindow, ShiftAssignment, ShiftKind } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

export type BulkAssignSkipReason =
	| { kind: 'already_on_shift' }
	| { kind: 'clash'; jobTitle: string; startTime: string; endTime: string }
	| { kind: 'shift_full' }
	| { kind: 'bad_shift_time'; message: string };

export type BulkAssignItem = {
	shift: JobShift;
	volunteer: Volunteer;
	/** What the dispatch needs, so the caller sends it as is. */
	dutyWindow: DutyWindow;
	shiftKind: ShiftKind;
};

export type BulkAssignSkip = {
	shift: JobShift;
	volunteer: Volunteer;
	reason: BulkAssignSkipReason;
};

export type BulkAssignPlan = { assign: BulkAssignItem[]; skipped: BulkAssignSkip[] };

type PlanInput = Omit<AssignRosterInput, 'shift' | 'volunteers'> & {
	/** The shifts to fill, in the order they are filled. */
	shifts: readonly JobShift[];
	/** The people to place in each of them. */
	volunteers: readonly Volunteer[];
};

/**
 * Walks the shifts in order. A pair that goes through is counted for the later shifts, so the same
 * person is not planned into two shifts that clash, and a shift's seats run out as it is filled.
 */
export function planBulkAssign(input: PlanInput): BulkAssignPlan {
	const { shifts, volunteers, assignments, job } = input;
	const held: ShiftAssignment[] = [...assignments];
	const plan: BulkAssignPlan = { assign: [], skipped: [] };

	for (const shift of shifts) {
		let dutyWindow: DutyWindow;
		try {
			dutyWindow = shiftDutyWindow(shift);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'กะนี้มีวันหรือเวลาไม่ถูกต้อง';
			for (const volunteer of volunteers) {
				plan.skipped.push({ shift, volunteer, reason: { kind: 'bad_shift_time', message } });
			}
			continue;
		}
		const shiftKind = shiftKindFor(shift);
		const roster = buildAssignRoster({ ...input, shift, volunteers, assignments: held });
		let seats = Math.max(shift.quota - assignmentCountForShift(shift, job._id, held), 0);

		for (const candidate of roster) {
			const { volunteer, state } = candidate;
			if (state.kind === 'accepted') {
				plan.skipped.push({ shift, volunteer, reason: { kind: 'already_on_shift' } });
			} else if (state.kind === 'collision') {
				plan.skipped.push({
					shift,
					volunteer,
					reason: {
						kind: 'clash',
						jobTitle: state.jobTitle,
						startTime: state.startTime,
						endTime: state.endTime
					}
				});
			} else if (seats <= 0) {
				plan.skipped.push({ shift, volunteer, reason: { kind: 'shift_full' } });
			} else {
				seats -= 1;
				plan.assign.push({ shift, volunteer, dutyWindow, shiftKind });
				held.push({
					volunteer_id: volunteer._id,
					job_id: job._id,
					shift_id: shift.id,
					duty_window: dutyWindow,
					status: 'assigned'
				} as ShiftAssignment);
			}
		}
	}
	return plan;
}

/** One line for a pair that did not go through, e.g. `สมชาย ใจดี — กะ 2026-11-10 08:00-12:00: กะเต็มแล้ว`. */
export function describePair(shift: JobShift, volunteer: Volunteer, why: string): string {
	const who = `${volunteer.first_name} ${volunteer.last_name}`.trim() || volunteer._id;
	return `${who} — กะ ${shift.date} ${shift.start_time}-${shift.end_time}: ${why}`;
}

export function describeSkip(skip: BulkAssignSkip): string {
	const r = skip.reason;
	const why =
		r.kind === 'already_on_shift'
			? 'อยู่ในกะนี้แล้ว'
			: r.kind === 'clash'
				? `เวลาซ้อนกับ ${r.jobTitle} (${r.startTime}-${r.endTime})`
				: r.kind === 'shift_full'
					? 'กะเต็มแล้ว'
					: r.message;
	return describePair(skip.shift, skip.volunteer, why);
}
