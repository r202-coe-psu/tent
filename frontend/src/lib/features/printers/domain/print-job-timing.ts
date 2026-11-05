import { MAX_LABELS_PER_JOB } from './print-job.schema';

/** A queued job nobody claims expires after this long (plan §3.3). */
export const JOB_TTL_SEC = 120;

/** Largest `created_at` lead over the server clock still treated as honest clock skew (FR-12a). */
export const CLOCK_SKEW_SEC = 5;

const LEASE_BASE_SEC = 90;
/** Headroom per label: the Pi waits for CUPS to finish each label before reporting. */
const LEASE_PER_LABEL_SEC = 5;

/** Housekeeping sweep period: an overdue job turns terminal at most this long after its deadline. */
export const SWEEP_INTERVAL_SEC = 30;

/** How long a claimed job may stay `printing` before the sweeper fails it (`lease_expired`). */
export function leaseSecFor(labelCount: number): number {
	return LEASE_BASE_SEC + LEASE_PER_LABEL_SEC * labelCount;
}

/**
 * A Pi that is up long-polls and claims a job within a second or two; still pending after this,
 * the tablet hints staff to check the printer (it does not offer a retry: the job may still print).
 */
export const PRINT_JOB_PICKUP_HINT_MS = 10_000;

/**
 * Longest the tablet waits for the create POST to answer. Past it the request is aborted and the
 * user may retry: the retry reuses the same job id, so a job the BFF did write is not queued twice.
 */
export const PRINT_JOB_CREATE_TIMEOUT_MS = 15_000;

/** Slack for the 1 s status poll and clock jitter. */
const POLL_MARGIN_SEC = 15;

/**
 * The tablet stops waiting for a job only after the server must have settled it: a full job can
 * stay pending until its TTL, then printing for its lease, then wait for the next sweep. Giving up
 * earlier would offer a retry while the job could still print (duplicate labels).
 */
export const PRINT_JOB_POLL_TIMEOUT_MS =
	(JOB_TTL_SEC + leaseSecFor(MAX_LABELS_PER_JOB) + SWEEP_INTERVAL_SEC + POLL_MARGIN_SEC) * 1000;

const toMs = (now: Date | number): number => (typeof now === 'number' ? now : now.getTime());

/**
 * The deadline that counts for a pending job, in epoch ms. Staff can write jobs straight into
 * CouchDB, so `expires_at` is capped at `created_at + JOB_TTL_SEC` (FR-12a). If either timestamp
 * is not a valid ISO date the job is untrustworthy and gets `-Infinity`, i.e. already expired.
 */
export function effectiveExpiryMs(job: { created_at: string; expires_at: string }): number {
	const created = Date.parse(job.created_at);
	const expires = Date.parse(job.expires_at);
	if (Number.isNaN(created) || Number.isNaN(expires)) return -Infinity;
	return Math.min(expires, created + JOB_TTL_SEC * 1000);
}

/** `created_at` is more than `CLOCK_SKEW_SEC` ahead of the server clock (forged or broken clock). */
export function isCreatedInFuture(job: { created_at: string }, now: Date | number): boolean {
	return Date.parse(job.created_at) > toMs(now) + CLOCK_SKEW_SEC * 1000;
}

/** A pending job the claim/sweep must expire instead of handing to a printer (FR-12a). */
export function isPendingExpired(
	job: { created_at: string; expires_at: string },
	now: Date | number
): boolean {
	return isCreatedInFuture(job, now) || toMs(now) >= effectiveExpiryMs(job);
}
