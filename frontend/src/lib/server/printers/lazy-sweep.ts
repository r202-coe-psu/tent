import {
	applyRetention,
	sweepJobs,
	type PrintJobRetentionStore,
	type PrintJobStore
} from './print-queue.server';

/**
 * Print-job housekeeping (plan §3.5). The lease/expiry sweep runs at most once per 30 s per
 * process, retention (purge + compact) at most once an hour. A process-wide timer drives both, so
 * stale jobs and their label PNGs go away even when no Pi polls; Pi polls also trigger the sweep.
 */
const SWEEP_INTERVAL_MS = 30_000;
const RETENTION_INTERVAL_MS = 60 * 60_000;

let lastSweepAt = Number.NEGATIVE_INFINITY;
let lastRetentionAt = Number.NEGATIVE_INFINITY;
let timer: ReturnType<typeof setInterval> | null = null;

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

/** Never throws; a failed run is retried in the next hourly window. */
export async function retainIfDue(store: PrintJobRetentionStore, now: Date): Promise<void> {
	if (now.getTime() - lastRetentionAt < RETENTION_INTERVAL_MS) return;
	lastRetentionAt = now.getTime();
	try {
		await applyRetention(store, now);
	} catch {
		// next window retries
	}
}

export interface HousekeepingOptions {
	/** False until DB `printing` exists, so the timer never creates it on a server without printers. */
	isProvisioned: () => Promise<boolean>;
}

/** Start the process-wide housekeeping timer (idempotent; does not keep the process alive). */
export function startPrintHousekeeping(
	store: PrintJobStore & PrintJobRetentionStore,
	{ isProvisioned }: HousekeepingOptions
): void {
	if (timer) return;
	timer = setInterval(async () => {
		try {
			if (!(await isProvisioned())) return;
		} catch {
			return;
		}
		await sweepIfDue(store, new Date());
		await retainIfDue(store, new Date());
	}, SWEEP_INTERVAL_MS);
	timer.unref?.();
}

/** Test seam: forget the last runs and stop the timer so each test starts with both due. */
export function resetLazySweep(): void {
	lastSweepAt = Number.NEGATIVE_INFINITY;
	lastRetentionAt = Number.NEGATIVE_INFINITY;
	if (timer) clearInterval(timer);
	timer = null;
}
