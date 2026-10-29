import { bangkokDateString, shiftDutyWindow } from './duty-window';
import { defaultShiftEndDate } from './shift-batch';

/** The part of a job shift that decides when public applications stop (#972). */
export type ClosableShift = {
	date: string;
	end_date?: string | null;
	start_time?: string | null;
	end_time?: string | null;
};

/**
 * Whether the public can still apply to this shift: until it ENDS, in Asia/Bangkok time.
 *
 * A shift in progress is still open. A shift that crosses midnight ends on the next day
 * (`end_date`, or derived when the row lacks it). A flex shift has no end time and closes
 * at the end of its `date`. A row too malformed to date stays open: hiding a job over bad
 * data would be worse than showing it.
 */
export function isShiftOpen(shift: ClosableShift, now: Date | string = new Date()): boolean {
	const nowMs = new Date(now).getTime();
	if (!shift.start_time || !shift.end_time) {
		const lastDay = shift.end_date || shift.date;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return true;
		return bangkokDateString(new Date(nowMs)) <= lastDay;
	}
	try {
		const { end_ts } = shiftDutyWindow({
			date: shift.date,
			end_date: shift.end_date || defaultShiftEndDate(shift.date, shift.start_time, shift.end_time),
			start_time: shift.start_time,
			end_time: shift.end_time
		});
		return nowMs < new Date(end_ts).getTime();
	} catch {
		return true;
	}
}

export function openShifts<S extends ClosableShift>(
	shifts: readonly S[],
	now: Date | string = new Date()
): S[] {
	return shifts.filter((shift) => isShiftOpen(shift, now));
}

/**
 * A job still takes applications while at least one shift is open. A job without shift rows
 * (an older projection) has nothing to date, so it counts as open.
 */
export function hasOpenShift(
	job: { shifts?: readonly ClosableShift[] },
	now: Date | string = new Date()
): boolean {
	const shifts = job.shifts ?? [];
	return shifts.length === 0 || shifts.some((shift) => isShiftOpen(shift, now));
}

/** Open jobs first in their given order, then closed ones in theirs. */
export function openJobsFirst<T>(jobs: readonly T[], isOpen: (job: T) => boolean): T[] {
	return [...jobs.filter(isOpen), ...jobs.filter((job) => !isOpen(job))];
}
