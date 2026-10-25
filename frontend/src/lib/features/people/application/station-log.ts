/**
 * application/station-log.ts — staff-side station_log helpers (CR-192)
 *
 * The station_log write is best-effort: when it fails the station action (report-in,
 * screening, zoning) has already succeeded, so staff get a warning toast — not an error toast —
 * and must not be pushed to save again (FR-STL-04).
 */
import { toast } from 'svelte-sonner';
import type { AuthorContext } from '$lib/db/model';
import { peopleRepository } from '../data/people.remote';
import type { StationLogWriteOptions } from '../data/people.repository';
import { STATION_LOG_WRITE_WARNING, type StationNumber } from '../domain/station-log';

/**
 * Run a repository write that also appends `station_log` docs. A log failure is turned into one
 * warning toast and never changes the result (or the rejection) of the write itself.
 */
export async function withStationLogWarning<T>(
	run: (stationLog: StationLogWriteOptions) => Promise<T>,
	base: Pick<StationLogWriteOptions, 'startedAt'> = {}
): Promise<T> {
	let logFailed = false;
	const result = await run({ ...base, onStationLogError: () => (logFailed = true) });
	if (logFailed) toast.warning(STATION_LOG_WRITE_WARNING);
	return result;
}

/** Keys of starts already requested from this page session, so an effect re-run cannot double-write. */
const requestedStarts = new Set<string>();

/**
 * Write the staff `start` of a Station 2/3 visit when the evacuee's page is opened. Idempotent
 * across reopen / refresh (see `recordStationStart`) and never throws.
 */
export async function startStaffStationVisit(
	evacueeId: string,
	station: StationNumber,
	ctx: AuthorContext
): Promise<void> {
	const key = `${evacueeId}:${station}`;
	if (!evacueeId || requestedStarts.has(key)) return;
	requestedStarts.add(key);
	try {
		await peopleRepository().recordStationStart(evacueeId, station, ctx);
	} catch {
		// Let the next open of the page retry; tell staff the timing record is missing.
		requestedStarts.delete(key);
		toast.warning(STATION_LOG_WRITE_WARNING);
	}
}
