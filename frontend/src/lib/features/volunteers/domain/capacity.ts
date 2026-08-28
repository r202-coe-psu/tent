/**
 * capacity.ts — shift-level fill-rate (CR-094 FR-VOL-09.4).
 *
 * "แถบสรุปอัตราจองกะต้องคำนวณระดับกะ (ไม่ใช่ระดับงาน)" — fill rate is computed
 * per shift bucket (e.g. one `job_id` + `date` + `shift` combination), never
 * aggregated at the job level first. Buckets: critical(<50%), near(50–99%),
 * met(100%).
 */

export type FillBucket = 'critical' | 'near' | 'met';

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
 * ⚠️ Approximation, deliberately explicit: `shift_assignment` does not yet
 * carry the id of the specific `job.shifts[]` row it fills, so there is no
 * per-shift confirmed count to read. The job-level `slots_confirmed` is
 * therefore allocated greedily — earliest shift filled first — which keeps the
 * NUMBER of shifts in each bucket right even though which particular shift is
 * short may be off. Replace this with a real per-shift tally once
 * `shift_assignment` gains a `job_shift_id` (follow-up, needs a CR).
 */
export function jobShiftCapacities(job: {
	_id: string;
	shifts: readonly { id: string; quota: number }[];
	slots_confirmed: number;
}): ShiftCapacity[] {
	let left = Math.max(job.slots_confirmed, 0);
	return job.shifts.map((shift) => {
		const confirmed = Math.min(left, shift.quota);
		left -= confirmed;
		return { key: `${job._id}#${shift.id}`, target: shift.quota, confirmed };
	});
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
 * Same deliberate approximation (and the same reason) as
 * {@link jobShiftCapacities}: `shift_assignment` carries no `job_shift_id`
 * yet, so there is no real per-shift tally to read. Confirmed is filled
 * greedily earliest-shift-first, then dispatched into what is left. The
 * per-shift TOTALS therefore always reconcile with the job document
 * (`sum(confirmed) === job.slots_confirmed`, likewise dispatched/remaining),
 * while WHICH shift holds a given seat is a best guess. This lives here, not
 * in the UI, so no screen recomputes the split itself.
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
