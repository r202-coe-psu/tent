// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { SWEEP_INTERVAL_SEC } from '$lib/features/printers/domain/print-job-timing';
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
const SWEEP_INTERVAL_MS = SWEEP_INTERVAL_SEC * 1000;
const RETENTION_INTERVAL_MS = 60 * 60_000;

let lastSweepAt = Number.NEGATIVE_INFINITY;
let lastRetentionAt = Number.NEGATIVE_INFINITY;

/** On `globalThis`, not a module `let`: vite dev re-imports this module on HMR. */
const TIMER_KEY: unique symbol = Symbol.for('tent.printHousekeepingTimer');
type TimerHolder = { [TIMER_KEY]?: ReturnType<typeof setInterval> };
const holder = globalThis as TimerHolder;

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
	if (holder[TIMER_KEY]) return;
	const timer = setInterval(async () => {
		try {
			if (!(await isProvisioned())) return;
		} catch {
			return;
		}
		await sweepIfDue(store, new Date());
		await retainIfDue(store, new Date());
	}, SWEEP_INTERVAL_MS);
	timer.unref?.();
	holder[TIMER_KEY] = timer;
}

/** Test seam: forget the last runs and stop the timer so each test starts with both due. */
export function resetLazySweep(): void {
	lastSweepAt = Number.NEGATIVE_INFINITY;
	lastRetentionAt = Number.NEGATIVE_INFINITY;
	clearInterval(holder[TIMER_KEY]);
	delete holder[TIMER_KEY];
}
