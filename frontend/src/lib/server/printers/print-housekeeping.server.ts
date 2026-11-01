// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { SWEEP_INTERVAL_SEC } from '$lib/features/printers/domain/print-job-timing';
import type { PrintHousekeepingState } from './print-device.repo';
import {
	applyRetention,
	sweepJobs,
	type PrintJobRetentionStore,
	type PrintJobStore
} from './print-queue.server';

/**
 * Print-job housekeeping (plan §3.5, FR-17..20). A container calls `runHousekeeping` through the
 * internal endpoint every ~30 s, so stale jobs and their label PNGs go away even when no Pi polls;
 * Pi polls also trigger a cheap per-shelter sweep (`sweepIfDue`).
 *
 * The lease/expiry sweep runs on every call. Retention (delete finished jobs older than 7 days,
 * then `_compact`) runs at most once an hour; "last ran" lives in the `print_housekeeping` doc,
 * not in module memory, because consecutive calls may be served by different processes.
 */
const SWEEP_INTERVAL_MS = SWEEP_INTERVAL_SEC * 1000;
const RETENTION_INTERVAL_MS = 60 * 60_000;
const MAX_ERROR_LENGTH = 500;

export interface HousekeepingDevices {
	/** Start `_compact` on `printing_devices` (heartbeats leave many old revisions behind). */
	compactDevicesDb(): Promise<void>;
	readHousekeepingState(): Promise<PrintHousekeepingState | null>;
	writeHousekeepingState(state: PrintHousekeepingState): Promise<void>;
}

export interface HousekeepingRun {
	/** Upper-case codes of shelters that have a provisioned print-job DB. */
	listShelters(): Promise<string[]>;
	storeFor(shelterCode: string): PrintJobStore & PrintJobRetentionStore;
	devices: HousekeepingDevices;
	now: Date;
}

export interface HousekeepingResult {
	/** Jobs the sweeper moved to a terminal status (`lease_expired` failures + expired). */
	swept: number;
	/** Finished jobs removed by retention (CR field name; they are deleted, not `_purge`d). */
	purged: number;
	/** Databases whose `_compact` was started (shelter DBs + the devices DB). */
	compacted: number;
	/** Failures recorded this run; the messages go to `last_error` in the state doc. */
	errors: number;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRetentionDue(state: PrintHousekeepingState | null, now: Date): boolean {
	const last = state?.last_retention_at ? Date.parse(state.last_retention_at) : Number.NaN;
	return Number.isNaN(last) || now.getTime() - last >= RETENTION_INTERVAL_MS;
}

/**
 * One housekeeping pass over every registered shelter. A shelter that fails is recorded and the
 * loop goes on (FR-20); retention still compacts a DB whose removal failed. Never throws: the
 * outcome is the returned counts plus the `print_housekeeping` doc.
 */
export async function runHousekeeping({
	listShelters,
	storeFor,
	devices,
	now
}: HousekeepingRun): Promise<HousekeepingResult> {
	const result: HousekeepingResult = { swept: 0, purged: 0, compacted: 0, errors: 0 };
	const messages: string[] = [];
	const fail = (scope: string, error: unknown) => {
		result.errors += 1;
		messages.push(`${scope}: ${describeError(error)}`);
	};

	let previous: PrintHousekeepingState | null = null;
	let retentionDue = false;
	try {
		previous = await devices.readHousekeepingState();
		retentionDue = isRetentionDue(previous, now);
	} catch (error) {
		// Unknown state: skip retention this run rather than compacting on every call.
		fail('state', error);
	}

	let shelters: string[] = [];
	try {
		shelters = await listShelters();
	} catch (error) {
		// Nothing to apply retention to: leave `last_retention_at` alone so the next run retries.
		retentionDue = false;
		fail('registry', error);
	}

	for (const code of shelters) {
		try {
			const store = storeFor(code);
			const { failed, expired } = await sweepJobs(store, now);
			result.swept += failed + expired;
			if (!retentionDue) continue;
			// Counted at the port so a failed removal still reports what was removed and compacted.
			const counting: PrintJobRetentionStore = {
				findFinishedBefore: (cutoff) => store.findFinishedBefore(cutoff),
				async purge(docs) {
					await store.purge(docs);
					result.purged += docs.length;
				},
				async compact() {
					await store.compact();
					result.compacted += 1;
				}
			};
			await applyRetention(counting, now);
		} catch (error) {
			fail(code, error);
		}
	}

	if (retentionDue) {
		try {
			await devices.compactDevicesDb();
			result.compacted += 1;
		} catch (error) {
			fail('printing_devices', error);
		}
	}

	try {
		await devices.writeHousekeepingState({
			last_run_at: now.toISOString(),
			last_retention_at: retentionDue ? now.toISOString() : (previous?.last_retention_at ?? null),
			last_error: messages.length > 0 ? messages.join('; ').slice(0, MAX_ERROR_LENGTH) : null
		});
	} catch (error) {
		fail('state', error);
	}
	return result;
}

const lastSweepAt = new Map<string, number>();

/**
 * Cheap sweep for a Pi poll: at most once per 30 s per process and shelter. Never throws: a
 * failing sweep must not fail the poll (and is not retried before the next window).
 */
export async function sweepIfDue(
	store: PrintJobStore,
	shelterCode: string,
	now: Date
): Promise<void> {
	const key = shelterCode.toUpperCase();
	if (now.getTime() - (lastSweepAt.get(key) ?? Number.NEGATIVE_INFINITY) < SWEEP_INTERVAL_MS)
		return;
	lastSweepAt.set(key, now.getTime());
	try {
		await sweepJobs(store, now);
	} catch {
		// next window retries
	}
}

/** Test seam: forget the last sweeps so each test starts with every shelter due. */
export function resetSweepThrottle(): void {
	lastSweepAt.clear();
}
