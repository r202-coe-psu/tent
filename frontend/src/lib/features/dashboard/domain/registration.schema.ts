/**
 * domain/schema.ts — dashboard-registration
 *
 * Canonical response shape for the registrations endpoint.
 * CouchDB view: `_design/app/_view/registrations_by_date_status?group=true`
 *
 * Supports optional date-range filtering via query params:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * No PII: only per-day registration counts (security-rbac-bestpractices §3).
 */
import { z } from 'zod';
import { bangkokToday } from '$lib/utils/date';

/** ISO date string (YYYY-MM-DD). */
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

/** Query params schema for the registrations endpoint. */
export const RegistrationsQuerySchema = z
	.object({
		/** Inclusive start date (YYYY-MM-DD). Defaults to the day the shelter was created. */
		from: IsoDate.optional(),
		/** Inclusive end date (YYYY-MM-DD). Defaults to today (Asia/Bangkok) when absent. */
		to: IsoDate.optional()
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, {
		message: '`from` must not be after `to`',
		path: ['from']
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
	/** Map of YYYY-MM-DD → count for each day in the range that has check-ins. */
	checkin: z.record(IsoDate, z.number().int().nonnegative()),
	/** Map of YYYY-MM-DD → count for each day in the range that has check-outs. */
	checkout: z.record(IsoDate, z.number().int().nonnegative()),
	/**
	 * Map of YYYY-MM-DD → evacuees registered in advance (web, kiosk or api) that day,
	 * excluding cancelled stays. Counts the registration, so it is not reduced by a later check-in.
	 */
	preregister: z.record(IsoDate, z.number().int().nonnegative()),
	/** Sum of all check-in counts. Pre-registrations are not included. */
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
	rows: { key: string | string[]; value: number }[],
	from: string,
	to: string
): RegistrationsPayload {
	const checkin: Record<string, number> = {};
	const checkout: Record<string, number> = {};
	const preregister: Record<string, number> = {};
	let total = 0;
	for (const row of rows) {
		// Note: BFF usually processes this instead of client directly for this endpoint,
		// but if this is used by BFF, it needs to handle [date, series] format.
		// The implementation plan says BFF handles it directly in +server.ts.
		// Let's adapt this just in case:
		let dateStr: string;
		let series: string = 'checkin';

		if (Array.isArray(row.key)) {
			dateStr = row.key[0];
			series = row.key[1];
		} else {
			dateStr = row.key;
		}

		if (series === 'checkin') {
			checkin[dateStr] = (checkin[dateStr] ?? 0) + row.value;
			total += row.value;
		} else if (series === 'checkout') {
			checkout[dateStr] = (checkout[dateStr] ?? 0) + row.value;
		} else if (series === 'preregister') {
			preregister[dateStr] = (preregister[dateStr] ?? 0) + row.value;
		}
	}
	return { shelter_code: shelterCode, range: { from, to }, checkin, checkout, preregister, total };
}

/**
 * The start date used when the caller gives none: the day the shelter was created, so
 * the dashboard covers the shelter's whole life rather than a fixed recent window.
 *
 * Dates are Asia/Bangkok — the same calendar day `registrations_by_date_status` buckets
 * movements into. A movement dated before `created_at` (back-filled or migrated data)
 * pulls the start back so it is never hidden, and the start never passes `to`.
 *
 * @param shelterCreatedAt - the registry shelter's `created_at` (ISO), if known
 * @param earliestRowDate  - the first `YYYY-MM-DD` the view returned, if any
 * @param to               - inclusive end date (`YYYY-MM-DD`)
 */
export function defaultRangeFrom(
	shelterCreatedAt: string | null | undefined,
	earliestRowDate: string | undefined,
	to: string
): string {
	const created = shelterCreatedAt ? new Date(shelterCreatedAt) : null;
	const candidates = [
		created && !Number.isNaN(created.getTime()) ? bangkokToday(created) : undefined,
		earliestRowDate,
		to
	].filter((date): date is string => !!date);
	return candidates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

/** Range choices on the registration chart (CR-170 FR-1). */
export const REGISTRATION_RANGE_PRESETS = ['7d', '14d', '30d', 'since_open', 'custom'] as const;
export type RegistrationRangePreset = (typeof REGISTRATION_RANGE_PRESETS)[number];

/** The range the chart opens with (CR-170 FR-5). */
export const DEFAULT_REGISTRATION_RANGE_PRESET: RegistrationRangePreset = 'since_open';

const PRESET_DAYS: Partial<Record<RegistrationRangePreset, number>> = {
	'7d': 7,
	'14d': 14,
	'30d': 30
};

/** `YYYY-MM-DD` shifted by whole days — calendar arithmetic, no time zone involved. */
export function shiftIsoDate(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/**
 * The `from` / `to` query params for a preset.
 *
 * - `N วันล่าสุด` covers N days including today: `from` = today − (N−1) (CR-170 FR-2).
 * - `since_open` sends neither, so the server starts at the shelter's creation day (FR-3).
 * - `custom` passes the picked range through.
 *
 * @param today - today's date (`YYYY-MM-DD`, Asia/Bangkok)
 */
export function registrationRangeParams(
	preset: RegistrationRangePreset,
	today: string,
	custom?: { from: string; to: string }
): { from?: string; to?: string } {
	const days = PRESET_DAYS[preset];
	if (days) return { from: shiftIsoDate(today, -(days - 1)), to: today };
	if (preset === 'custom' && custom) return { from: custom.from, to: custom.to };
	return {};
}
