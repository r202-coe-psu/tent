/**
 * domain/schema.ts — dashboard-occupancy
 *
 * Defines the canonical API response shape for the occupancy endpoint.
 * Source-of-truth for CouchDB view → API mapping (CR-020, T-52).
 *
 * CouchDB view: `_design/app/_view/occupancy?group=true`
 * Keys emitted: 'pre_registered' | 'active' | 'temporary_leave' | 'transferred' |
 *               'checked_out' | 'deceased' (schema.md schema_v 3 — the current
 *               6-value `StayStatus` enum, `current_stay.status` verbatim)
 *
 * No PII: only aggregate counts leave the server (security-rbac-bestpractices §3).
 */
import { z } from 'zod';

/**
 * Shape of one row returned by the occupancy view (?group=true).
 * key = current_stay.status value; value = count (number).
 */
export const OccupancyViewRowSchema = z.object({
	key: z.string(),
	value: z.number().int().nonnegative()
});

/** Aggregate occupancy statistics returned by GET /dashboard/occupancy. */
export const OccupancyPayloadSchema = z.object({
	/** The shelter code this data belongs to. */
	shelter_code: z.string(),
	/** Count of evacuees with status = 'pre_registered' (registered, not yet checked in). */
	pre_registered: z.number().int().nonnegative(),
	/** Count of evacuees with status = 'active' (physically present in the shelter). */
	active: z.number().int().nonnegative(),
	/** Count of evacuees with status = 'temporary_leave' (checked in, temporarily away). */
	temporary_leave: z.number().int().nonnegative(),
	/** Count of evacuees with status = 'transferred' (moved to another shelter). */
	transferred: z.number().int().nonnegative(),
	/** Count of evacuees with status = 'checked_out' (departed / returned home). */
	checked_out: z.number().int().nonnegative(),
	/** Count of evacuees with status = 'deceased'. */
	deceased: z.number().int().nonnegative(),
	/** Total evacuee count = sum of all status buckets. */
	total: z.number().int().nonnegative()
});

export type OccupancyPayload = z.infer<typeof OccupancyPayloadSchema>;

/**
 * Parse CouchDB view rows into an OccupancyPayload.
 * Unknown status keys are silently discarded to future-proof against new statuses.
 */
export function rowsToOccupancyPayload(
	shelterCode: string,
	rows: { key: string; value: number }[]
): OccupancyPayload {
	const counts: Record<string, number> = {};
	for (const row of rows) {
		counts[row.key] = (counts[row.key] ?? 0) + row.value;
	}
	const pre_registered = counts['pre_registered'] ?? 0;
	const active = counts['active'] ?? 0;
	const temporary_leave = counts['temporary_leave'] ?? 0;
	const transferred = counts['transferred'] ?? 0;
	const checked_out = counts['checked_out'] ?? 0;
	const deceased = counts['deceased'] ?? 0;
	return {
		shelter_code: shelterCode,
		pre_registered,
		active,
		temporary_leave,
		transferred,
		checked_out,
		deceased,
		total: pre_registered + active + temporary_leave + transferred + checked_out + deceased
	};
}
