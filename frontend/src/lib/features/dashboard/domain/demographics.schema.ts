/**
 * domain/schema.ts — dashboard-demographics
 *
 * Canonical response shape for the demographics endpoint.
 * Two CouchDB views are queried in parallel (CR-020, T-52):
 *   1. `demographics_by_age?group=true`         — active evacuee birth-year counts; API buckets by current year
 *   2. `demographics_by_country?group=true`  — country counts
 *
 * No PII: all data is aggregate-only (security-rbac-bestpractices §3).
 */
import { z } from 'zod';

/**
 * Age buckets for staff demographics (system overview + shelter dashboard).
 * Keys are inclusive ranges except `<1` (age 0 only).
 */
export const AGE_BUCKETS = ['<1', '1-5', '6-11', '12-19', '20-59', '60+', 'unknown'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** Thai display labels for {@link AGE_BUCKETS}. */
export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
	'<1': 'ทารก (< 1 ปี)',
	'1-5': 'เด็กเล็ก (1–5 ปี)',
	'6-11': 'เด็กโต (6–11 ปี)',
	'12-19': 'วัยรุ่น (12–19 ปี)',
	'20-59': 'ผู้ใหญ่ (20–59 ปี)',
	'60+': 'ผู้สูงอายุ (60 ปีขึ้นไป)',
	unknown: 'ไม่ระบุ'
};

/**
 * Age-group breakdown.
 * Every bucket is present in the payload; missing view keys default to 0.
 */
export const AgeGroupsSchema = z.object({
	'<1': z.number().int().nonnegative(),
	'1-5': z.number().int().nonnegative(),
	'6-11': z.number().int().nonnegative(),
	'12-19': z.number().int().nonnegative(),
	'20-59': z.number().int().nonnegative(),
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

export function emptyAgeGroups(): AgeGroups {
	return { '<1': 0, '1-5': 0, '6-11': 0, '12-19': 0, '20-59': 0, '60+': 0, unknown: 0 };
}

/**
 * Thai Buddhist birth year → age bucket.
 * Age = currentGregorianYear − (birthYearBe − 543).
 */
export function ageBucketForBirthYear(
	birthYear: number | null | undefined,
	currentYear = new Date().getFullYear()
): AgeBucket {
	if (birthYear == null || !Number.isFinite(birthYear)) return 'unknown';
	const age = currentYear - (birthYear - 543);
	if (!Number.isFinite(age) || age < 0) return 'unknown';
	if (age < 1) return '<1';
	if (age <= 5) return '1-5';
	if (age <= 11) return '6-11';
	if (age <= 19) return '12-19';
	if (age <= 59) return '20-59';
	return '60+';
}

/**
 * Map `demographics_by_age` view rows to the typed AgeGroups object.
 * Unknown bucket keys are discarded.
 */
export function rowsToAgeGroups(rows: { key: string; value: number }[]): AgeGroups {
	const blank = emptyAgeGroups();
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
