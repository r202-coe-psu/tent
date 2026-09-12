/**
 * capacity.ts — shift-level fill-rate (CR-094 FR-VOL-09.4).
 *
 * "แถบสรุปอัตราจองกะต้องคำนวณระดับกะ (ไม่ใช่ระดับงาน)" — fill rate is computed
 * per shift bucket (e.g. one `job_id` + `date` + `shift` combination), never
 * aggregated at the job level first. Buckets: critical(<50%), near(50–99%),
 * met(100%).
 */

import { sameDutyWindow, shiftDutyWindow } from './duty-window';
import type { JobStatus, JobShift } from './job.schema';
import type { ShiftAssignment } from './shift-assignment.schema';

export type FillBucket = 'critical' | 'near' | 'met';

/** Job lifecycle states whose shifts represent currently tracked capacity. */
export type CapacityTrackedJobStatus = Extract<JobStatus, 'open' | 'full'>;

export const CAPACITY_TRACKED_JOB_STATUSES: ReadonlySet<CapacityTrackedJobStatus> = new Set([
	'open',
	'full'
]);

/** Paused, draft and terminal jobs do not represent capacity currently being filled. */
export function isCapacityTrackedJobStatus(status: JobStatus): status is CapacityTrackedJobStatus {
	return CAPACITY_TRACKED_JOB_STATUSES.has(status as CapacityTrackedJobStatus);
}

export interface ShiftCapacity {
	/** Opaque grouping key, e.g. `${job_id}:${date}:${shift}`. Not interpreted here. */
	key: string;
	/** How many volunteers this shift needs. */
	target: number;
	/** How many are confirmed for this shift right now. */
	confirmed: number;
}

/** Fill rate for a single shift, clamped to [0, 1]. `target <= 0` reads as 0 (critical). */
export function shiftFillRate(capacity: Pick<ShiftCapacity, 'target' | 'confirmed'>): number {
	if (capacity.target <= 0) return 0;
	return Math.min(Math.max(capacity.confirmed, 0) / capacity.target, 1);
}

/** critical < 50% · near 50–99% · met 100% (CR-094 FR-VOL-09.4). */
export function bucketFillRate(rate: number): FillBucket {
	if (rate >= 1) return 'met';
	if (rate >= 0.5) return 'near';
	return 'critical';
}

/** Aggregate booking rate across shift buckets: sum(confirmed) / sum(target). */
export function overallBookingRate(
	capacities: readonly Pick<ShiftCapacity, 'target' | 'confirmed'>[]
): number {
	const totals = capacities.reduce(
		(acc, c) => ({
			target: acc.target + c.target,
			confirmed: acc.confirmed + Math.max(c.confirmed, 0)
		}),
		{ target: 0, confirmed: 0 }
	);
	if (totals.target <= 0) return 0;
	return Math.min(totals.confirmed / totals.target, 1);
}

/** Count shift buckets per fill bucket — backs the clickable summary chips. */
export function bucketCounts(
	capacities: readonly Pick<ShiftCapacity, 'target' | 'confirmed'>[]
): Record<FillBucket, number> {
	const counts: Record<FillBucket, number> = { critical: 0, near: 0, met: 0 };
	for (const c of capacities) {
		counts[bucketFillRate(shiftFillRate(c))] += 1;
	}
	return counts;
}

/**
 * One capacity bucket per SUB-SHIFT of a job (CR-094 FR-VOL-09.4 counts "กะ",
 * not jobs).
 *
 * When assignments are supplied, this uses the exact `shift_id` roster and falls
 * back to the duty window only for legacy rows during migration. Without assignments
 * it retains the job-level projection fallback for callers with only a job snapshot.
 */
export function jobShiftCapacities(
	job: {
		_id: string;
		shifts: readonly (Pick<JobShift, 'id' | 'quota'> &
			Partial<Pick<JobShift, 'date' | 'end_date' | 'start_time' | 'end_time'>>)[];
		slots_confirmed: number;
	},
	assignments?: readonly ShiftAssignment[]
): ShiftCapacity[] {
	if (assignments) {
		return job.shifts.map((shift) => ({
			key: `${job._id}#${shift.id}`,
			target: shift.quota,
			confirmed: confirmedAssignmentsForShift(job._id, shift, assignments)
		}));
	}
	let left = Math.max(job.slots_confirmed, 0);
	return job.shifts.map((shift) => {
		const confirmed = Math.min(left, shift.quota);
		left -= confirmed;
		return { key: `${job._id}#${shift.id}`, target: shift.quota, confirmed };
	});
}

/**
 * Count the current confirmed roster for one concrete shift. New assignments use
 * `shift_id`; the duty-window fallback is only for legacy rows during migration.
 * A volunteer is counted once even if duplicate legacy rows exist.
 */
function confirmedAssignmentsForShift(
	jobId: string,
	shift: Pick<JobShift, 'id'> &
		Partial<Pick<JobShift, 'date' | 'end_date' | 'start_time' | 'end_time'>>,
	assignments: readonly ShiftAssignment[]
): number {
	let window: ReturnType<typeof shiftDutyWindow> | null = null;
	if (shift.date && shift.end_date && shift.start_time && shift.end_time) {
		try {
			window = shiftDutyWindow({
				...shift,
				date: shift.date,
				end_date: shift.end_date,
				start_time: shift.start_time,
				end_time: shift.end_time
			});
		} catch {
			window = null;
		}
	}
	const volunteerIds = new Set<string>();
	for (const assignment of assignments) {
		if (
			assignment.job_id !== jobId ||
			!['assigned', 'standby', 'checked_in'].includes(assignment.status) ||
			assignment.dispatch_status === 'dispatched'
		)
			continue;
		const matches = assignment.shift_id
			? assignment.shift_id === shift.id
			: window
				? sameDutyWindow(assignment.duty_window, window)
				: false;
		if (matches) volunteerIds.add(assignment.volunteer_id);
	}
	return volunteerIds.size;
}

/** Per-sub-shift 3-way quota split, mirroring `quota.ts#computeQuota` at job level. */
export interface ShiftQuotaSplit extends ShiftCapacity {
	/** Offered, awaiting accept/decline (🟡). */
	dispatched: number;
	/** `target - confirmed - dispatched` (⚪). */
	remaining: number;
}

/**
 * Allocate a job's `slots_confirmed` and `slots_dispatched` down to its
 * sub-shifts so the detail screen can draw one 3-colour bar per shift.
 *
 * This remains a projection fallback for the detail card. The roster modal is the
 * authoritative exact count because it receives assignments and filters by `shift_id`.
 */
export function jobShiftQuotaSplits(job: {
	_id: string;
	shifts: readonly { id: string; quota: number }[];
	slots_confirmed: number;
	slots_dispatched: number;
}): ShiftQuotaSplit[] {
	let confirmedLeft = Math.max(job.slots_confirmed, 0);
	let dispatchedLeft = Math.max(job.slots_dispatched, 0);
	return job.shifts.map((shift) => {
		const confirmed = Math.min(confirmedLeft, shift.quota);
		confirmedLeft -= confirmed;
		const dispatched = Math.min(dispatchedLeft, shift.quota - confirmed);
		dispatchedLeft -= dispatched;
		return {
			key: `${job._id}#${shift.id}`,
			target: shift.quota,
			confirmed,
			dispatched,
			remaining: shift.quota - confirmed - dispatched
		};
	});
}
