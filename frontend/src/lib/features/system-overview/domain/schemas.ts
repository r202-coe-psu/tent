import { z } from 'zod';
import {
	AGE_BUCKETS,
	AgeGroupsSchema,
	ageBucketForBirthYear,
	emptyAgeGroups,
	type AgeBucket,
	type AgeGroups
} from '$lib/features/dashboard/domain/demographics.schema';
import { operationStatusSchema, siteKindSchema } from '$lib/features/shelters/domain/schema';

export const movementWindowSchema = z.enum(['today', '7d']);
export type MovementWindow = z.infer<typeof movementWindowSchema>;

/** ISO calendar date `YYYY-MM-DD` (Thailand local day when defaulted). */
export const isoDateSchema = z
	.string()
	.trim()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export type IsoDate = z.infer<typeof isoDateSchema>;

/** Thailand (UTC+7) calendar date as `YYYY-MM-DD`. */
export function thailandDateString(d = new Date()): string {
	const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
	return shifted.toISOString().slice(0, 10);
}

/**
 * Default sites เข้า/ออก movement range: inclusive 14 calendar days ending today (Thailand).
 * `from` = today − 13 days, `to` = today.
 */
export function defaultMovementDateRange(d = new Date()): { from: string; to: string } {
	const to = thailandDateString(d);
	const [y, m, day] = to.split('-').map(Number);
	const start = new Date(Date.UTC(y, m - 1, day));
	start.setUTCDate(start.getUTCDate() - 13);
	return { from: start.toISOString().slice(0, 10), to };
}

export const stayBucketSchema = z.enum([
	'all',
	'present',
	'forecast',
	'pre_registered',
	'checked_out'
]);
export type StayBucket = z.infer<typeof stayBucketSchema>;

export const ageBandSchema = z.enum(AGE_BUCKETS);
export type AgeBand = AgeBucket;

export const overviewFiltersSchema = z.object({
	residence_province: z.string().trim().optional(),
	residence_district: z.string().trim().optional(),
	residence_subdistrict: z.string().trim().optional(),
	shelter_province: z.string().trim().optional(),
	shelter_district: z.string().trim().optional(),
	shelter_subdistrict: z.string().trim().optional(),
	operation_status: operationStatusSchema.optional(),
	site_kind: siteKindSchema.optional(),
	stay_bucket: stayBucketSchema.optional().default('all'),
	country: z.string().trim().optional(),
	age_band: ageBandSchema.optional(),
	/** @deprecated Prefer movement_from / movement_to; kept as API fallback. */
	movement_window: movementWindowSchema.optional().default('today'),
	movement_from: isoDateSchema.optional(),
	movement_to: isoDateSchema.optional(),
	q: z.string().trim().optional(),
	source: z.enum(['all', 'unassigned', 'bound']).optional().default('all'),
	shelter_code: z.string().trim().optional(),
	limit: z.coerce.number().int().min(1).max(200).optional().default(50),
	offset: z.coerce.number().int().min(0).optional().default(0)
});

export type OverviewFilters = z.infer<typeof overviewFiltersSchema>;

const FILTER_KEYS = [
	'residence_province',
	'residence_district',
	'residence_subdistrict',
	'shelter_province',
	'shelter_district',
	'shelter_subdistrict',
	'operation_status',
	'site_kind',
	'stay_bucket',
	'country',
	'age_band',
	'movement_window',
	'movement_from',
	'movement_to',
	'q',
	'source',
	'shelter_code',
	'limit',
	'offset'
] as const;

/** Parse URLSearchParams into OverviewFilters (missing keys → defaults). */
export function parseOverviewFilters(params: URLSearchParams): OverviewFilters {
	const raw: Record<string, string> = {};
	for (const key of FILTER_KEYS) {
		const v = params.get(key);
		if (v !== null && v !== '') raw[key] = v;
	}
	return overviewFiltersSchema.parse(raw);
}

export function overviewFiltersToSearchParams(filters: Partial<OverviewFilters>): URLSearchParams {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value === undefined || value === null || value === '' || value === 'all') continue;
		if (key === 'movement_window' && value === 'today') continue;
		if (key === 'stay_bucket' && value === 'all') continue;
		if (key === 'source' && value === 'all') continue;
		if (key === 'limit' && value === 50) continue;
		if (key === 'offset' && value === 0) continue;
		params.set(key, String(value));
	}
	return params;
}

/** Resolve inclusive movement date range from explicit from/to or legacy window. */
export function resolveMovementDateRange(
	filters: Pick<OverviewFilters, 'movement_from' | 'movement_to' | 'movement_window'>
): { from: string; to: string } {
	const fromRaw = filters.movement_from;
	const toRaw = filters.movement_to;
	if (fromRaw || toRaw) {
		const a = fromRaw ?? toRaw!;
		const b = toRaw ?? fromRaw!;
		return a <= b ? { from: a, to: b } : { from: b, to: a };
	}
	const to = thailandDateString();
	if (filters.movement_window === '7d') {
		const start = new Date();
		start.setUTCDate(start.getUTCDate() - 6);
		return { from: thailandDateString(start), to };
	}
	return { from: to, to };
}

/** CR-112 Present: active | room_confirmed | temporary_leave */
export function presentFromCounts(c: Record<string, number>): number {
	return (c.active ?? 0) + (c.room_confirmed ?? 0) + (c.temporary_leave ?? 0);
}

/** CR-112 Forecast: Present + pre_registered + arriving */
export function forecastFromCounts(c: Record<string, number>): number {
	return presentFromCounts(c) + (c.pre_registered ?? 0) + (c.arriving ?? 0);
}

/** Thai Buddhist birth year → age band (matches shelter demographics BFF). */
export const ageBandForBirthYear = ageBucketForBirthYear;

export { emptyAgeGroups };

export function pct(numerator: number, denominator: number): number | null {
	if (!denominator || denominator <= 0) return null;
	return Math.round((numerator / denominator) * 1000) / 10;
}

export const overviewSummarySchema = z.object({
	unassigned_members: z.number().int().nonnegative(),
	unassigned_registrations: z.number().int().nonnegative(),
	pre_registered_at_sites: z.number().int().nonnegative(),
	present_total: z.number().int().nonnegative(),
	forecast_total: z.number().int().nonnegative(),
	avg_present_pct: z.number().nullable(),
	avg_forecast_pct: z.number().nullable(),
	sites_by_status: z.record(z.string(), z.number().int().nonnegative()),
	checkouts_in_window: z.number().int().nonnegative(),
	sites_closed: z.number().int().nonnegative(),
	sites_open_with_present: z.number().int().nonnegative(),
	sites_total: z.number().int().nonnegative(),
	movement_window: movementWindowSchema
});
export type OverviewSummary = z.infer<typeof overviewSummarySchema>;

export const overviewSiteRowSchema = z.object({
	shelter_code: z.string(),
	name: z.string(),
	site_kind: siteKindSchema,
	operation_status: z.string(),
	province: z.string().nullable(),
	district: z.string().nullable(),
	subdistrict: z.string().nullable(),
	capacity: z.number().int().nonnegative(),
	present: z.number().int().nonnegative(),
	forecast: z.number().int().nonnegative(),
	pre_registered: z.number().int().nonnegative(),
	present_pct: z.number().nullable(),
	forecast_pct: z.number().nullable(),
	/** Check-ins in movement_from…movement_to (inclusive). */
	checkin: z.number().int().nonnegative(),
	/** Check-outs in movement_from…movement_to (inclusive). */
	checkout: z.number().int().nonnegative(),
	has_coords: z.boolean(),
	dashboard_href: z.string()
});
export type OverviewSiteRow = z.infer<typeof overviewSiteRowSchema>;

export const overviewSitesPayloadSchema = z.object({
	sites: z.array(overviewSiteRowSchema)
});
export type OverviewSitesPayload = z.infer<typeof overviewSitesPayloadSchema>;

export const originBucketSchema = z.object({
	province: z.string(),
	district: z.string().nullable(),
	subdistrict: z.string().nullable(),
	count: z.number().int().nonnegative()
});
export type OriginBucket = z.infer<typeof originBucketSchema>;

export const overviewOriginPayloadSchema = z.object({
	buckets: z.array(originBucketSchema)
});
export type OverviewOriginPayload = z.infer<typeof overviewOriginPayloadSchema>;

export const overviewDemographicsPayloadSchema = z.object({
	age_groups: AgeGroupsSchema,
	countries: z.record(z.string(), z.number().int().nonnegative()),
	/** Age breakdown keyed by normalized country code (e.g. THAILAND). */
	age_by_country: z.record(z.string(), AgeGroupsSchema).default({})
});
export type OverviewDemographicsPayload = z.infer<typeof overviewDemographicsPayloadSchema>;

// Re-export for callers that already import AgeGroups from this module.
export type { AgeGroups };

export const overviewMovementsPayloadSchema = z.object({
	/** Present only when range was resolved from legacy movement_window. */
	window: movementWindowSchema.optional(),
	from: z.string(),
	to: z.string(),
	checkin: z.number().int().nonnegative(),
	checkout: z.number().int().nonnegative()
});
export type OverviewMovementsPayload = z.infer<typeof overviewMovementsPayloadSchema>;

export const preRegSourceSchema = z.enum(['unassigned', 'bound']);
export type PreRegSource = z.infer<typeof preRegSourceSchema>;

export const preRegistrationListItemSchema = z.object({
	id: z.string(),
	source: preRegSourceSchema,
	display_name: z.string(),
	province: z.string().nullable(),
	district: z.string().nullable(),
	subdistrict: z.string().nullable(),
	country: z.string().nullable(),
	birth_year: z.number().nullable(),
	age: z.number().nullable(),
	age_band: ageBandSchema,
	queue_status: z.string(),
	shelter_code: z.string().nullable(),
	shelter_name: z.string().nullable(),
	registered_at: z.string().nullable(),
	profile_href: z.string(),
	registration_id: z.string().nullable(),
	evacuee_id: z.string().nullable()
});
export type PreRegistrationListItem = z.infer<typeof preRegistrationListItemSchema>;

export const preRegistrationsListPayloadSchema = z.object({
	items: z.array(preRegistrationListItemSchema),
	total: z.number().int().nonnegative(),
	limit: z.number().int(),
	offset: z.number().int()
});
export type PreRegistrationsListPayload = z.infer<typeof preRegistrationsListPayloadSchema>;

export const preRegistrationProfileSchema = z.object({
	source: preRegSourceSchema,
	display_name: z.string(),
	person_id_masked: z.string().nullable(),
	phone: z.string().nullable(),
	country: z.string().nullable(),
	birth_year: z.number().nullable(),
	age: z.number().nullable(),
	vulnerable_groups: z.array(z.string()),
	special_needs: z.array(z.string()),
	queue_status: z.string(),
	shelter_code: z.string().nullable(),
	shelter_name: z.string().nullable(),
	shelter_href: z.string().nullable(),
	registered_via: z.string().nullable(),
	registered_at: z.string().nullable(),
	residence: z
		.object({
			housing_type: z.string().nullable(),
			landmark: z.string().nullable(),
			address_no: z.string().nullable(),
			province: z.string().nullable(),
			district: z.string().nullable(),
			subdistrict: z.string().nullable()
		})
		.nullable(),
	members: z.array(
		z.object({
			id: z.string(),
			display_name: z.string(),
			status: z.string().nullable(),
			country: z.string().nullable(),
			birth_year: z.number().nullable()
		})
	)
});
export type PreRegistrationProfile = z.infer<typeof preRegistrationProfileSchema>;
