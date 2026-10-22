import { MAX_LABELS_PER_JOB } from './print-job.schema';

/** A queued job nobody claims expires after this long (plan §3.3). */
export const JOB_TTL_SEC = 120;

const LEASE_BASE_SEC = 90;
/** Headroom per label: the Pi waits for CUPS to finish each label before reporting. */
const LEASE_PER_LABEL_SEC = 5;

/** Housekeeping sweep period: an overdue job turns terminal at most this long after its deadline. */
export const SWEEP_INTERVAL_SEC = 30;

/** How long a claimed job may stay `printing` before the sweeper fails it (`lease_expired`). */
export function leaseSecFor(labelCount: number): number {
	return LEASE_BASE_SEC + LEASE_PER_LABEL_SEC * labelCount;
}

/** Slack for the 1 s status poll and clock jitter. */
const POLL_MARGIN_SEC = 15;

/**
 * The tablet stops waiting for a job only after the server must have settled it: a full job can
 * stay pending until its TTL, then printing for its lease, then wait for the next sweep. Giving up
 * earlier would offer a retry while the job could still print (duplicate labels).
 */
export const PRINT_JOB_POLL_TIMEOUT_MS =
	(JOB_TTL_SEC + leaseSecFor(MAX_LABELS_PER_JOB) + SWEEP_INTERVAL_SEC + POLL_MARGIN_SEC) * 1000;
