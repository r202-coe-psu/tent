import { z } from 'zod';
import { makeDoc, catalogDoc, type AuthorContext, touch, shelterCodeSchema } from '$lib/db/model';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

export const SOP_RATIO_KEYS = [
	'water_l_per_person_day',
	'drinking_water_l_per_person_day',
	'cooking_water_l_per_person_day',
	'hygiene_water_l_per_person_day',
	'kcal_per_adult_day',
	'people_per_tap',
	'people_per_handpump',
	'people_per_open_well',
	'people_per_laundry',
	'people_per_bathing',
	'people_per_toilet_female',
	'people_per_toilet_male',
	'people_per_dining_point_adult',
	'people_per_dining_point_child',
	'm2_per_person_living',
	'm2_per_person_living_cold',
	'm2_per_person_total',
	'max_waterpoint_distance_m',
	'max_queue_minutes',
	'people_per_volunteer'
] as const;

export type SopRatioKey = (typeof SOP_RATIO_KEYS)[number];

export const SOP_RATIO_KIND: Record<SopRatioKey, 'multiply' | 'divide' | 'threshold'> = {
	water_l_per_person_day: 'multiply',
	drinking_water_l_per_person_day: 'multiply',
	cooking_water_l_per_person_day: 'multiply',
	hygiene_water_l_per_person_day: 'multiply',
	kcal_per_adult_day: 'multiply',
	people_per_tap: 'divide',
	people_per_handpump: 'divide',
	people_per_open_well: 'divide',
	people_per_laundry: 'divide',
	people_per_bathing: 'divide',
	people_per_toilet_female: 'divide',
	people_per_toilet_male: 'divide',
	people_per_dining_point_adult: 'divide',
	people_per_dining_point_child: 'divide',
	m2_per_person_living: 'multiply',
	m2_per_person_living_cold: 'multiply',
	m2_per_person_total: 'multiply',
	max_waterpoint_distance_m: 'threshold',
	max_queue_minutes: 'threshold',
	people_per_volunteer: 'divide'
};

const ratioShape = SOP_RATIO_KEYS.reduce(
	(acc, key) => ({ ...acc, [key]: z.number().positive() }),
	{} as Record<SopRatioKey, z.ZodNumber>
);

/**
 * Validates that all keys in the record are part of the whitelist
 * and that all values are positive numbers. Strict checking prevents
 * deprecated or care-allocation keys from leaking in.
 *
 * We adopted "Option 1" (Full 20-key strict snapshot for BOTH master and override)
 * to eliminate data drifts, simplify the compute engine, and satisfy constraints.
 * This 20-key strict schema applies universally to Master and Override.
 */
export const ratiosSchema = z.object(ratioShape).strict();

/**
 * @deprecated Use `ratiosSchema` directly. Both Master and Override now strictly require the full 20-key schema per CR-026 Option 1.
 */
export const fullRatiosSchema = ratiosSchema;

// --- Master SOP Profile Schema (catalog DB, schema_v 3)
// schema_v bumped 2→3 per CR-006 amendment (2026-06-25): key whitelist 3→20 canonical keys
export const SOP_MASTER_SCHEMA_VERSION = 3;

export const sopMasterSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('sop_profile'),
	schema_v: z.literal(SOP_MASTER_SCHEMA_VERSION),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1),
	name: z.string().min(1),
	// Master ratios use the unified 20-key strict schema (Option 1).
	ratios: ratiosSchema,
	version: z.number().int().positive(),
	active: z.boolean()
});

export type SopMaster = z.infer<typeof sopMasterSchema>;

export const isSopMaster = (d: unknown): d is SopMaster => sopMasterSchema.safeParse(d).success;

// --- Override SOP Profile Schema (shelter_* DB, schema_v 2)
// schema_v bumped 1→2 per CR-006 amendment (2026-06-25): key whitelist 3→20 canonical keys
export const SOP_OVERRIDE_SCHEMA_VERSION = 2;

export const sopOverrideSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('sop_override'),
	schema_v: z.literal(SOP_OVERRIDE_SCHEMA_VERSION),
	shelter_code: shelterCodeSchema,
	base_profile_id: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1),
	name: z.string().min(1),
	ratios: ratiosSchema,
	version: z.number().int().positive(),
	active: z.boolean()
});

export type SopOverride = z.infer<typeof sopOverrideSchema>;

export const isSopOverride = (d: unknown): d is SopOverride =>
	sopOverrideSchema.safeParse(d).success;

/**
 * Context types for the two flavours of SOP profiles.
 * Used in implementation signatures of createInitialProfile / createNewVersion
 * to replace `ctx: any` while still accepting both overload branches.
 */
type MasterCtx = { createdBy: string };
type OverrideCtx = AuthorContext & { base_profile_id: string };
type AnyProfileCtx = MasterCtx | OverrideCtx;

/**
 * Resolves the effective SOP profile ratios for a shelter:
 * If an active override is present, use its ratios.
 * Otherwise, fall back to the active master profile ratios.
 *
 * NOTE: This is a synchronous domain function that operates on in-memory models.
 * For the asynchronous helper that automatically loads data from database repositories,
 * use `resolveEffectiveRatios` in `$lib/features/sop-ratios`.
 */
export function resolveEffectiveProfile(
	override?: SopOverride | null,
	master?: SopMaster | null
): {
	ratios: Record<SopRatioKey, number>;
	ratio_source: 'master' | 'override';
} | null {
	if (override && override.active) {
		return {
			ratios: override.ratios,
			ratio_source: 'override'
		};
	}
	if (master && master.active) {
		return {
			ratios: master.ratios,
			ratio_source: 'master'
		};
	}
	return null;
}

// Overload signatures for createInitialProfile
export function createInitialProfile(
	targetType: 'sop_profile',
	name: string,
	ratios: Record<SopRatioKey, number>,
	ctx: { createdBy: string }
): { profile: SopMaster; audit: AuditEntry };

export function createInitialProfile(
	targetType: 'sop_override',
	name: string,
	ratios: Record<SopRatioKey, number>,
	ctx: AuthorContext & { base_profile_id: string }
): { profile: SopOverride; audit: AuditEntry };

/**
 * Creates the initial version of a new SOP Master Profile or SOP Override.
 */
export function createInitialProfile(
	targetType: 'sop_profile' | 'sop_override',
	name: string,
	ratios: Record<SopRatioKey, number>,
	ctx: AnyProfileCtx
): { profile: SopMaster | SopOverride; audit: AuditEntry } {
	// Both master and override require the full canonical set (Option 1).
	const safeRatios = ratiosSchema.parse(ratios) as Record<SopRatioKey, number>;

	if (targetType === 'sop_profile') {
		const profile = catalogDoc(
			'sop_profile',
			SOP_MASTER_SCHEMA_VERSION,
			{
				name,
				ratios: safeRatios,
				version: 1,
				active: true
			},
			ctx.createdBy
		) as SopMaster;

		sopMasterSchema.parse(profile);

		const audit = createAuditEntry(
			{
				action: 'created',
				target_type: 'sop_profile',
				target_id: profile._id,
				reason: 'Initial creation',
				context: {
					ratios: profile.ratios
				}
			},
			{ shelterCode: 'catalog', createdBy: ctx.createdBy }
		);

		return { profile, audit };
	} else {
		// targetType === 'sop_override': ctx is guaranteed to be OverrideCtx by the public overload
		const overrideCtx = ctx as OverrideCtx;
		const profile = makeDoc(
			'sop_override',
			SOP_OVERRIDE_SCHEMA_VERSION,
			{
				base_profile_id: overrideCtx.base_profile_id,
				name,
				ratios: safeRatios,
				version: 1,
				active: true
			},
			overrideCtx
		) as SopOverride;

		sopOverrideSchema.parse(profile);

		const audit = createAuditEntry(
			{
				action: 'created',
				target_type: 'sop_override',
				target_id: profile._id,
				reason: 'Initial creation',
				context: {
					ratios: profile.ratios,
					base_profile_id: overrideCtx.base_profile_id
				}
			},
			overrideCtx
		);

		return { profile, audit };
	}
}

export type CreateNewVersionResult<T extends SopMaster | SopOverride> =
	| { deactivatedPrev: T; profile: T; audit: AuditEntry }
	| { deactivatedPrev: null; profile: T; audit: null };

// Overload signatures for createNewVersion
export function createNewVersion(
	prev: SopMaster,
	changes: Partial<Record<SopRatioKey, number>>,
	reason: string,
	ctx: { createdBy: string }
): CreateNewVersionResult<SopMaster>;

export function createNewVersion(
	prev: SopOverride,
	changes: Partial<Record<SopRatioKey, number>>,
	reason: string,
	ctx: AuthorContext
): CreateNewVersionResult<SopOverride>;

/**
 * Creates a new version of an existing SOP Master Profile or SOP Override.
 * This is an immutable operation; the previous profile is not modified.
 * If changes yield an identical state, it aborts gracefully as an idempotent no-op.
 */
export function createNewVersion<T extends SopMaster | SopOverride>(
	prev: T,
	changes: Partial<Record<SopRatioKey, number>>,
	reason: string,
	ctx: MasterCtx | AuthorContext
): CreateNewVersionResult<T> {
	// Validate partial changes strictly to reject non-whitelist or deprecated keys
	const safeChanges = ratiosSchema.partial().strict().parse(changes);
	let hasChanges = false;
	const definedChanges: Partial<Record<SopRatioKey, number>> = {};

	for (const key of SOP_RATIO_KEYS) {
		if (safeChanges[key] !== undefined) {
			if (prev.ratios[key] !== safeChanges[key]) hasChanges = true;
			definedChanges[key] = safeChanges[key];
		}
	}

	if (!hasChanges) {
		return { deactivatedPrev: null, profile: prev, audit: null } as CreateNewVersionResult<T>;
	}

	const newRatios = { ...prev.ratios, ...definedChanges } as Record<SopRatioKey, number>;
	ratiosSchema.parse(newRatios);
	if (prev.type === 'sop_profile') {
		const createdBy = ctx.createdBy;

		const profile = catalogDoc(
			'sop_profile',
			SOP_MASTER_SCHEMA_VERSION,
			{
				name: prev.name,
				ratios: newRatios,
				version: prev.version + 1,
				active: true
			},
			createdBy
		) as SopMaster;

		sopMasterSchema.parse(profile);

		const audit = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'sop_profile',
				target_id: profile._id,
				reason,
				context: { previous_version: prev.version, previous_id: prev._id, changes: safeChanges }
			},
			{ shelterCode: 'catalog', createdBy }
		);

		const deactivatedPrev: SopMaster = {
			...prev,
			updated_at: new Date().toISOString(),
			active: false
		};

		return { deactivatedPrev, profile, audit } as CreateNewVersionResult<T>;
	} else {
		// prev is SopOverride: ctx is guaranteed to be AuthorContext by the public overload
		const overrideCtx = ctx as AuthorContext;
		const overridePrev = prev as SopOverride;
		const profile = makeDoc(
			'sop_override',
			SOP_OVERRIDE_SCHEMA_VERSION,
			{
				base_profile_id: overridePrev.base_profile_id,
				name: overridePrev.name,
				ratios: newRatios,
				version: overridePrev.version + 1,
				active: true
			},
			overrideCtx
		) as SopOverride;

		sopOverrideSchema.parse(profile);

		const audit = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'sop_override',
				target_id: profile._id,
				reason,
				context: {
					previous_version: overridePrev.version,
					previous_id: overridePrev._id,
					changes: safeChanges,
					base_profile_id: overridePrev.base_profile_id
				}
			},
			overrideCtx
		);

		const deactivatedPrev = {
			...touch(overridePrev),
			active: false
		} as SopOverride;

		return { deactivatedPrev, profile, audit } as CreateNewVersionResult<T>;
	}
}
