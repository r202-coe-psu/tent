/**
 * domain/schema.ts — dashboard-demographics
 *
 * Canonical response shape for the demographics endpoint.
 * Two CouchDB views are queried in parallel (CR-020, T-52):
 *   1. `demographics_by_age?group=true`         — age-bucket counts
 *   2. `demographics_by_country?group=true`  — country counts
 *
 * No PII: all data is aggregate-only (security-rbac-bestpractices §3).
 */
import { z } from 'zod';

/** Age buckets as defined in CR-020 §3. */
export const AGE_BUCKETS = ['0-4', '5-11', '12-17', '18-59', '60+', 'unknown'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/**
 * Age-group breakdown.
 * Every bucket is present in the payload; missing view keys default to 0.
 */
export const AgeGroupsSchema = z.object({
	'0-4': z.number().int().nonnegative(),
	'5-11': z.number().int().nonnegative(),
	'12-17': z.number().int().nonnegative(),
	'18-59': z.number().int().nonnegative(),
	'60+': z.number().int().nonnegative(),
	unknown: z.number().int().nonnegative()
});
export type AgeGroups = z.infer<typeof AgeGroupsSchema>;

/**
 * Country breakdown — arbitrary string keys (country name) → count.
 * 'UNKNOWN' is always present for evacuees with no country recorded.
 */
export const CountryBreakdownSchema = z.record(z.string(), z.number().int().nonnegative());
export type CountryBreakdown = z.infer<typeof CountryBreakdownSchema>;

/** Full demographics payload returned by GET /dashboard/demographics. */
export const DemographicsPayloadSchema = z.object({
	shelter_code: z.string(),
	age_groups: AgeGroupsSchema,
	countries: CountryBreakdownSchema
});
export type DemographicsPayload = z.infer<typeof DemographicsPayloadSchema>;

/**
 * Map `demographics_by_age` view rows to the typed AgeGroups object.
 * Unknown bucket keys are discarded.
 */
export function rowsToAgeGroups(rows: { key: string; value: number }[]): AgeGroups {
	const blank: AgeGroups = { '0-4': 0, '5-11': 0, '12-17': 0, '18-59': 0, '60+': 0, unknown: 0 };
	for (const row of rows) {
		if (row.key in blank) {
			blank[row.key as AgeBucket] += row.value;
		}
	}
	return blank;
}

/**
 * Map `demographics_by_country` view rows to a plain key→count record.
 */
export function rowsToCountries(rows: { key: string; value: number }[]): CountryBreakdown {
	const out: CountryBreakdown = {};
	for (const row of rows) {
		out[row.key] = (out[row.key] ?? 0) + row.value;
	}
	return out;
}
