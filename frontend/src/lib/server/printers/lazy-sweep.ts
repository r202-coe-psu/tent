import { sweepJobs, type PrintJobStore } from './print-queue.server';

/**
 * No cron: the housekeeping sweep (lease-expired / expired jobs) piggybacks on the Pi polls,
 * at most once per 30 s per process. Every Pi polls every ~25 s, so a stuck job is closed
 * within about a minute without a separate scheduler.
 */
const SWEEP_INTERVAL_MS = 30_000;

let lastSweepAt = Number.NEGATIVE_INFINITY;

/** Never throws: a failing sweep must not fail the poll (and is not retried before the next window). */
export async function sweepIfDue(store: PrintJobStore, now: Date): Promise<void> {
	if (now.getTime() - lastSweepAt < SWEEP_INTERVAL_MS) return;
	lastSweepAt = now.getTime();
	try {
		await sweepJobs(store, now);
	} catch {
		// next window retries
	}
}

/** Test seam: forget the last sweep so each test starts with a sweep due. */
export function resetLazySweep(): void {
	lastSweepAt = Number.NEGATIVE_INFINITY;
}
