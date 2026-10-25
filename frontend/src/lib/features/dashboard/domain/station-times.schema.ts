/**
 * domain/station-times.schema.ts — dashboard station service time (CR-192)
 *
 * Response shape of GET /dashboard/station-times. Rows are produced by pairing the
 * `station_logs_by_station` view events in the BFF (`summarizeStationTimes` in the people
 * domain); this file only describes and validates the payload.
 *
 * Aggregate counts and durations per (station, channel), plus a per-actor rank that names
 * staff by `display_name` only (CR-192 Amendment 2) — no other user fields.
 */
import { z } from 'zod';
import { RegistrationsQuerySchema } from './registration.schema';

/** Same `?from=YYYY-MM-DD&to=YYYY-MM-DD` contract as the registrations endpoint (CR-170). */
export const StationTimesQuerySchema = RegistrationsQuerySchema;
export type StationTimesQuery = z.infer<typeof StationTimesQuerySchema>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const StationTimeRowSchema = z.object({
	station: z.union([z.literal(1), z.literal(2), z.literal(3)]),
	channel: z.enum(['kiosk', 'staff']),
	/** Completed visits, including `complete` events with no `start` (throughput). */
	visits: z.number().int().nonnegative(),
	/** Visits with both `start` and `complete` — the denominator of the average. */
	timed_visits: z.number().int().nonnegative(),
	/** Mean service time in seconds over timed visits; null when there are none. */
	avg_duration_sec: z.number().nonnegative().nullable(),
	/** `start` with no `complete` yet, not older than the 2-hour stale window. */
	open_visits: z.number().int().nonnegative()
});
export type StationTimeRow = z.infer<typeof StationTimeRowSchema>;

/**
 * One entry of the per-actor rank (CR-192 Amendment 2): a staff member, or a kiosk device at
 * Station 1. Only visits the same actor started and completed count.
 */
export const StationActorRankSchema = z.object({
	station: z.union([z.literal(1), z.literal(2), z.literal(3)]),
	actor_id: z.string(),
	kind: z.enum(['kiosk', 'staff']),
	/** `_users.display_name`, falling back to the user name; `ตู้ {device_id}` for a kiosk. */
	display_name: z.string(),
	timed_visits: z.number().int().positive(),
	avg_duration_sec: z.number().nonnegative()
});
export type StationActorRank = z.infer<typeof StationActorRankSchema>;

export const StationTimesPayloadSchema = z.object({
	shelter_code: z.string(),
	/** Date range actually queried (after applying defaults). */
	range: z.object({ from: IsoDate, to: IsoDate }),
	/** One row per (station, channel): 1/staff, 1/kiosk, 2/staff, 3/staff. */
	stations: z.array(StationTimeRowSchema),
	/** Per-actor rank, fastest first within each station (FR-STL-35). */
	actors: z.array(StationActorRankSchema)
});
export type StationTimesPayload = z.infer<typeof StationTimesPayloadSchema>;

/** Visit-weighted mean service time (seconds) of a station across its channels; null if none timed. */
export function stationAverageSec(rows: readonly StationTimeRow[], station: number): number | null {
	let timed = 0;
	let total = 0;
	for (const r of rows) {
		if (r.station !== station || r.avg_duration_sec === null) continue;
		timed += r.timed_visits;
		total += r.avg_duration_sec * r.timed_visits;
	}
	return timed > 0 ? total / timed : null;
}

/** Service time as Thai text: `45 วินาที`, `6 นาที 30 วินาที`, or `—` when unknown. */
export function formatServiceDuration(sec: number | null): string {
	if (sec === null) return '—';
	const rounded = Math.round(sec);
	if (rounded < 60) return `${rounded} วินาที`;
	const minutes = Math.floor(rounded / 60);
	const seconds = rounded % 60;
	return seconds === 0 ? `${minutes} นาที` : `${minutes} นาที ${seconds} วินาที`;
}
