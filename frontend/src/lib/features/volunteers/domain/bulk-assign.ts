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
	| {
			kind: 'clash';
			/** The clashing shift is of the job being filled (an earlier shift of this run, or one held). */
			sameJob: boolean;
			jobTitle: string;
			startTime: string;
			endTime: string;
			/** The part of the day both shifts cover (`HH:mm`), when it can be told from the times. */
			overlap: { start: string; end: string } | null;
	  }
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
						sameJob: state.jobId === job._id,
						jobTitle: state.jobTitle,
						startTime: state.startTime,
						endTime: state.endTime,
						overlap: overlapOf(shift, state)
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

const minutes = (hhmm: string): number | null => {
	const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (total: number) =>
	`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/**
 * The part of the day two shifts both cover, from their wall-clock times. A shift past midnight
 * is left out: its times alone do not say where the overlap is.
 */
function overlapOf(
	shift: Pick<JobShift, 'start_time' | 'end_time'>,
	other: { startTime: string; endTime: string }
): { start: string; end: string } | null {
	const [a1, a2, b1, b2] = [shift.start_time, shift.end_time, other.startTime, other.endTime].map(
		minutes
	);
	if (a1 === null || a2 === null || b1 === null || b2 === null || a2 <= a1 || b2 <= b1) return null;
	const start = Math.max(a1, b1);
	const end = Math.min(a2, b2);
	return start < end ? { start: hhmm(start), end: hhmm(end) } : null;
}

/** Plain Thai for why a pair was not placed: what is wrong, not a code. */
export function skipReasonText(reason: BulkAssignSkipReason): string {
	switch (reason.kind) {
		case 'already_on_shift':
			return 'อยู่ในกะนี้อยู่แล้ว';
		case 'clash': {
			const who = reason.sameJob
				? 'ของงานนี้ที่เขาอยู่แล้ว'
				: `ของงาน "${reason.jobTitle}" ที่เขาอยู่แล้ว`;
			const where = reason.overlap
				? ` ซ้อนกันช่วง ${reason.overlap.start}-${reason.overlap.end} น.`
				: '';
			return `ชนกับกะ ${reason.startTime}-${reason.endTime} น. ${who}${where}`;
		}
		case 'shift_full':
			return 'กะนี้เต็มแล้ว';
		case 'bad_shift_time':
			return reason.message;
	}
}

/** What happened to one (volunteer, shift) pair of a run: placed, or not and why (plain Thai). */
export type BulkOutcome =
	| { shift: JobShift; volunteer: Volunteer; ok: true }
	| { shift: JobShift; volunteer: Volunteer; ok: false; why: string };

export type BulkPlacedItem = { shiftId: string; shift: string };
export type BulkNotPlacedItem = { shiftId: string; shift: string; why: string };

export type BulkPersonResult = {
	volunteerId: string;
	name: string;
	/** Shifts the person was placed in. */
	placed: BulkPlacedItem[];
	/** Shifts the person was not placed in, each with the reason. */
	notPlaced: BulkNotPlacedItem[];
};

export type BulkRunSummary = {
	placedCount: number;
	notPlacedCount: number;
	/** One entry per person, in the order they were chosen. */
	people: BulkPersonResult[];
};

const shiftText = (shift: JobShift) => {
	if (shift.end_date && shift.end_date !== shift.date) {
		return `${shift.date} ${shift.start_time} - ${shift.end_date} ${shift.end_time} น.`;
	}
	return `${shift.date} ${shift.start_time}-${shift.end_time} น.`;
};

/**
 * The result of a run, per person, so a user sees who got into which shifts and who did not and why
 * — instead of one flat list of problems. `order` is the chosen people, so the order is stable.
 */
export function summarizeBulk(
	order: readonly Volunteer[],
	outcomes: readonly BulkOutcome[]
): BulkRunSummary {
	const people = new Map<string, BulkPersonResult>(
		order.map((v) => [
			v._id,
			{
				volunteerId: v._id,
				name: `${v.first_name} ${v.last_name}`.trim() || v._id,
				placed: [],
				notPlaced: []
			}
		])
	);
	let placedCount = 0;
	let notPlacedCount = 0;
	for (const outcome of outcomes) {
		const person = people.get(outcome.volunteer._id);
		if (!person) continue;
		if (outcome.ok) {
			person.placed.push({ shiftId: outcome.shift.id, shift: shiftText(outcome.shift) });
			placedCount += 1;
		} else {
			person.notPlaced.push({
				shiftId: outcome.shift.id,
				shift: shiftText(outcome.shift),
				why: outcome.why
			});
			notPlacedCount += 1;
		}
	}
	return { placedCount, notPlacedCount, people: [...people.values()] };
}
