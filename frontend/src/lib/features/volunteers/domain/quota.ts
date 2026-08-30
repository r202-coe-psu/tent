/**
 * quota.ts — 3-Color Quota state machine (CR-094 §3.3 / CR-092 FR-VOL-06).
 *
 * Invariant, enforced after every transition:
 *   slots_confirmed + slots_dispatched + slots_remaining === quota
 *
 * All transitions are pure: `(state) => newState`. Callers persist the result
 * via the data layer's read-modify-write + 409 retry loop (00-foundation §00.3)
 * — this module never touches I/O.
 */

import type { JobStatus } from './job.schema';

export interface JobQuota {
	quota: number;
	slots_confirmed: number;
	slots_dispatched: number;
	slots_remaining: number;
}

export class QuotaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'QuotaError';
	}
}

function isNonNegativeInteger(n: number): boolean {
	return Number.isInteger(n) && n >= 0;
}

/** Derive the 3-color breakdown from a job's raw quota fields. */
export function computeQuota(
	job: Pick<JobQuota, 'quota' | 'slots_confirmed' | 'slots_dispatched'>
): {
	confirmed: number;
	dispatched: number;
	remaining: number;
} {
	const confirmed = job.slots_confirmed;
	const dispatched = job.slots_dispatched;
	const remaining = job.quota - confirmed - dispatched;
	// Validate rather than propagate: an unchecked NaN or negative `remaining`
	// silently reaches the 3-colour quota bar and renders as a real number.
	if (!isNonNegativeInteger(job.quota)) {
		throw new QuotaError(`quota must be a non-negative integer, got ${job.quota}`);
	}
	if (!isNonNegativeInteger(confirmed) || !isNonNegativeInteger(dispatched)) {
		throw new QuotaError(
			`slot counts must be non-negative integers, got confirmed=${confirmed} dispatched=${dispatched}`
		);
	}
	if (remaining < 0) {
		throw new QuotaError(
			`slots_confirmed(${confirmed}) + slots_dispatched(${dispatched}) exceeds quota(${job.quota})`
		);
	}
	return { confirmed, dispatched, remaining };
}

/**
 * Throws `QuotaError` unless `slots_confirmed + slots_dispatched + slots_remaining
 * === quota`, every bucket is non-negative, AND every bucket is an integer
 * (CR-094 §3.3 invariant — a fractional slot count like `0.5` is nonsensical
 * and must never pass, even if it happens to sum correctly).
 */
export function assertQuotaInvariant(job: JobQuota): void {
	const { quota, slots_confirmed, slots_dispatched, slots_remaining } = job;
	if (
		!Number.isInteger(slots_confirmed) ||
		!Number.isInteger(slots_dispatched) ||
		!Number.isInteger(slots_remaining)
	) {
		throw new QuotaError('Quota buckets must be integers');
	}
	if (slots_confirmed < 0 || slots_dispatched < 0 || slots_remaining < 0) {
		throw new QuotaError('Quota buckets must be non-negative');
	}
	const total = slots_confirmed + slots_dispatched + slots_remaining;
	if (total !== quota) {
		throw new QuotaError(
			`Quota invariant violated: confirmed(${slots_confirmed}) + dispatched(${slots_dispatched}) + remaining(${slots_remaining}) = ${total}, expected quota(${quota})`
		);
	}
}

/** SM dispatches `count` volunteers: remaining -1, dispatched +1 (per unit). */
export function applyDispatch(job: JobQuota, count = 1): JobQuota {
	if (!isNonNegativeInteger(count) || count === 0) {
		throw new QuotaError('Dispatch count must be a positive integer');
	}
	if (job.slots_remaining < count) {
		throw new QuotaError(`Cannot dispatch ${count}: only ${job.slots_remaining} slot(s) remaining`);
	}
	// F18 — build an explicit plain object (never `{...job, ...}`): callers
	// often pass a wider object (the full `Job` doc, with nested
	// `shift_template.days` etc) typed down to `JobQuota` — a shallow spread
	// would silently carry those extra properties (and their nested
	// references) along for the ride, so the result would alias the input's
	// nested state instead of being an independent snapshot.
	const next: JobQuota = {
		quota: job.quota,
		slots_confirmed: job.slots_confirmed,
		slots_dispatched: job.slots_dispatched + count,
		slots_remaining: job.slots_remaining - count
	};
	assertQuotaInvariant(next);
	return next;
}

/** Volunteer accepts a dispatched offer: dispatched -1, confirmed +1. */
export function applyAccept(job: JobQuota, count = 1): JobQuota {
	if (!isNonNegativeInteger(count) || count === 0) {
		throw new QuotaError('Accept count must be a positive integer');
	}
	if (job.slots_dispatched < count) {
		throw new QuotaError(`Cannot accept ${count}: only ${job.slots_dispatched} dispatched`);
	}
	const next: JobQuota = {
		quota: job.quota,
		slots_confirmed: job.slots_confirmed + count,
		slots_dispatched: job.slots_dispatched - count,
		slots_remaining: job.slots_remaining
	};
	assertQuotaInvariant(next);
	return next;
}

/**
 * Release a previously CONFIRMED slot back to remaining — the inverse of
 * {@link JobRepository#confirmSlot} (`applyAccept(applyDispatch(...))`, which
 * always ends with `slots_dispatched` unchanged). Used when an SM removes a
 * volunteer from a shift they were already outright-assigned to
 * (`ShiftAssignmentRepository#unassign`): confirmed -1, remaining +1.
 */
export function applyRelease(job: JobQuota, count = 1): JobQuota {
	if (!isNonNegativeInteger(count) || count === 0) {
		throw new QuotaError('Release count must be a positive integer');
	}
	if (job.slots_confirmed < count) {
		throw new QuotaError(`Cannot release ${count}: only ${job.slots_confirmed} confirmed`);
	}
	const next: JobQuota = {
		quota: job.quota,
		slots_confirmed: job.slots_confirmed - count,
		slots_dispatched: job.slots_dispatched,
		slots_remaining: job.slots_remaining + count
	};
	assertQuotaInvariant(next);
	return next;
}

/** Volunteer declines a dispatched offer: dispatched -1, remaining +1. */
export function applyDecline(job: JobQuota, count = 1): JobQuota {
	if (!isNonNegativeInteger(count) || count === 0) {
		throw new QuotaError('Decline count must be a positive integer');
	}
	if (job.slots_dispatched < count) {
		throw new QuotaError(`Cannot decline ${count}: only ${job.slots_dispatched} dispatched`);
	}
	const next: JobQuota = {
		quota: job.quota,
		slots_confirmed: job.slots_confirmed,
		slots_dispatched: job.slots_dispatched - count,
		slots_remaining: job.slots_remaining + count
	};
	assertQuotaInvariant(next);
	return next;
}

// ---------------------------------------------------------------------------
// F7 — job status derivation (CR-094 FR-VOL-13.2 / FR-VOL-09.3 "เต็มโควตา" filter)
// ---------------------------------------------------------------------------

/**
 * Share of `quota` that may still be unfilled while a job counts as "almost
 * full". Derived from `slots_remaining`, which already nets out both
 * `slots_confirmed` and `slots_dispatched` — a job with 9 of 10 slots offered
 * out and awaiting acceptance is not `open` in any useful sense.
 *
 * The `Math.max(1, …)` floor keeps `almost_full` reachable at every quota
 * size: with a pure 20% band, a `quota: 3` job jumps straight from `open` to
 * `full` and the "ใกล้ครบเป้า" filter never matches it.
 *
 * PENDING OWNER SIGN-OFF: neither CR-094 nor schema.md specifies this rule.
 * Single source of truth for both back-office and the public board.
 */
export const ALMOST_FULL_REMAINING_RATIO = 0.2;

/** Largest `slots_remaining` that still counts as `almost_full` for a quota. */
export function almostFullCutoff(quota: number): number {
	return Math.max(1, Math.ceil(quota * ALMOST_FULL_REMAINING_RATIO));
}

/** Statuses `deriveJobStatus` is allowed to move a job between — everything else is manual/terminal. */
const AUTO_MANAGED_STATUSES: ReadonlySet<JobStatus> = new Set(['open', 'almost_full', 'full']);

/**
 * Pure `job.status` derivation from the current quota fill level (CR-094
 * FR-VOL-13.2 — nothing else ever moves a job `open -> almost_full -> full`,
 * so without this a fully-staffed job stays `open` forever and keeps
 * appearing on the public board). Never touches `draft`/`paused`/`closed`/
 * `cancelled` — those are manual/terminal states outside the automatic quota
 * flow; only `open`/`almost_full`/`full` are managed by this function.
 */
export function deriveJobStatus(
	job: Pick<JobQuota, 'quota' | 'slots_confirmed' | 'slots_dispatched' | 'slots_remaining'> & {
		status: JobStatus;
	}
): JobStatus {
	if (!AUTO_MANAGED_STATUSES.has(job.status)) return job.status;
	if (job.slots_remaining <= 0) return 'full';
	if (job.slots_remaining <= almostFullCutoff(job.quota)) return 'almost_full';
	return 'open';
}
