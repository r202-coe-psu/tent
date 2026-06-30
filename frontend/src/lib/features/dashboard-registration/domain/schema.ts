/**
 * domain/schema.ts — dashboard-registration
 *
 * Canonical response shape for the registrations endpoint.
 * CouchDB view: `_design/app/_view/registrations_by_date?group=true`
 *
 * Supports optional date-range filtering via query params:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * No PII: only per-day registration counts (security-rbac-bestpractices §3).
 */
import { z } from 'zod';

/** ISO date string (YYYY-MM-DD). */
const IsoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

/** Query params schema for the registrations endpoint. */
export const RegistrationsQuerySchema = z.object({
	/** Inclusive start date (YYYY-MM-DD). Defaults to 30 days ago when absent. */
	from: IsoDate.optional(),
	/** Inclusive end date (YYYY-MM-DD). Defaults to today when absent. */
	to: IsoDate.optional()
});
export type RegistrationsQuery = z.infer<typeof RegistrationsQuerySchema>;

/**
 * Daily registration counts returned by GET /dashboard/registrations.
 * `daily` is sorted ascending by date string (lexicographic = chronological).
 */
export const RegistrationsPayloadSchema = z.object({
	shelter_code: z.string(),
	/** Date range actually queried (after applying defaults). */
	range: z.object({ from: IsoDate, to: IsoDate }),
	/** Map of YYYY-MM-DD → count for each day in the range that has registrations. */
	daily: z.record(IsoDate, z.number().int().nonnegative()),
	/** Sum of all counts in `daily`. */
	total: z.number().int().nonnegative()
});
export type RegistrationsPayload = z.infer<typeof RegistrationsPayloadSchema>;

/**
 * Convert `registrations_by_date` view rows to RegistrationsPayload.
 *
 * @param shelterCode - the shelter this data belongs to
 * @param rows        - rows from CouchDB (?group=true): { key: 'YYYY-MM-DD', value: count }
 * @param from        - inclusive start date string used in the query
 * @param to          - inclusive end date string used in the query
 */
export function rowsToRegistrationsPayload(
	shelterCode: string,
	rows: { key: string; value: number }[],
	from: string,
	to: string
): RegistrationsPayload {
	const daily: Record<string, number> = {};
	let total = 0;
	for (const row of rows) {
		daily[row.key] = (daily[row.key] ?? 0) + row.value;
		total += row.value;
	}
	return { shelter_code: shelterCode, range: { from, to }, daily, total };
}

/**
 * Build a default date range: `from` = 30 days ago, `to` = today.
 * Both strings are in YYYY-MM-DD format (UTC).
 */
export function defaultDateRange(): { from: string; to: string } {
	const now = new Date();
	const to = now.toISOString().slice(0, 10);
	const fromDate = new Date(now);
	fromDate.setUTCDate(fromDate.getUTCDate() - 30);
	const from = fromDate.toISOString().slice(0, 10);
	return { from, to };
}
