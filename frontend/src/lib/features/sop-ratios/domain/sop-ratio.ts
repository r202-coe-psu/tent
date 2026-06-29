import { z } from 'zod';
import { makeDoc, type AuthorContext, touch, shelterCodeSchema, catalogDoc } from '$lib/db/model';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

export const SOP_RATIO_KEYS = [
	'water_l_per_person_day',
	'rice_g_per_person_meal',
	'toilet_per_person'
] as const;

export type SopRatioKey = (typeof SOP_RATIO_KEYS)[number];

const ratioShape = SOP_RATIO_KEYS.reduce(
	(acc, key) => ({ ...acc, [key]: z.number().positive() }),
	{} as Record<SopRatioKey, z.ZodNumber>
);

export const ratiosSchema = z
	.object(ratioShape)
	.partial()
	.refine((r) => Object.keys(r).length > 0, {
		message: 'At least one ratio must be specified'
	});

export const sopMasterSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('sop_profile'),
	schema_v: z.literal(2),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1),
	name: z.string().min(1),
	ratios: ratiosSchema,
	version: z.number().int().positive(),
	active: z.boolean()
});

export type SopMasterProfile = z.infer<typeof sopMasterSchema>;

export const isSopMasterProfile = (d: unknown): d is SopMasterProfile =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'sop_profile';

export const sopOverrideSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('sop_override'),
	schema_v: z.literal(1),
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

export type SopOverrideProfile = z.infer<typeof sopOverrideSchema>;

export const isSopOverrideProfile = (d: unknown): d is SopOverrideProfile =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'sop_override';

export type SopRatioProfile = SopMasterProfile | SopOverrideProfile;

export function resolveEffectiveProfile(
	master: SopMasterProfile,
	override?: SopOverrideProfile | null
): Partial<Record<SopRatioKey, number>> {
	if (override && override.active) {
		return override.ratios;
	}
	return master.ratios;
}

export function createInitialMasterProfile(
	name: string,
	ratios: Partial<Record<SopRatioKey, number>>,
	createdBy: string
): { profile: SopMasterProfile; audit: AuditEntry } {
	const safeRatios: Partial<Record<SopRatioKey, number>> = {};
	for (const key of SOP_RATIO_KEYS) {
		if (ratios[key] !== undefined) safeRatios[key] = ratios[key];
	}

	const profile = catalogDoc(
		'sop_profile',
		2,
		{
			name,
			ratios: safeRatios,
			version: 1,
			active: true
		},
		createdBy
	) as SopMasterProfile;

	sopMasterSchema.parse(profile);

	const audit = createAuditEntry(
		{
			action: 'created',
			target_type: 'sop_profile',
			target_id: profile._id,
			reason: 'Initial creation',
			context: { ratios: profile.ratios }
		},
		{ shelterCode: 'catalog', createdBy }
	);

	return { profile, audit };
}

export function createInitialOverrideProfile(
	name: string,
	baseProfileId: string,
	ratios: Partial<Record<SopRatioKey, number>>,
	ctx: AuthorContext
): { profile: SopOverrideProfile; audit: AuditEntry } {
	const safeRatios: Partial<Record<SopRatioKey, number>> = {};
	for (const key of SOP_RATIO_KEYS) {
		if (ratios[key] !== undefined) safeRatios[key] = ratios[key];
	}

	const profile = makeDoc(
		'sop_override',
		1,
		{
			base_profile_id: baseProfileId,
			name,
			ratios: safeRatios,
			version: 1,
			active: true
		},
		ctx
	) as SopOverrideProfile;

	sopOverrideSchema.parse(profile);

	const audit = createAuditEntry(
		{
			action: 'created',
			target_type: 'sop_override',
			target_id: profile._id,
			reason: 'Initial override creation',
			context: { ratios: profile.ratios, base_profile_id: baseProfileId }
		},
		ctx
	);

		return { profile, audit };
	} else {
		// targetType === 'sop_override': ctx is guaranteed to be OverrideCtx by the public overload
		const overrideCtx = ctx as OverrideCtx;
		const profile = makeDoc(
			'sop_override',
			1,
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

export type CreateNewVersionResult<T> =
	| { deactivatedPrev: T; profile: T; audit: AuditEntry }
	| { deactivatedPrev: null; profile: T; audit: null };

export function createNewMasterVersion(
	prev: SopMasterProfile,
	changes: Partial<Record<SopRatioKey, number>>,
	reason: string,
	createdBy: string
): CreateNewVersionResult<SopMasterProfile> {
	const safeChanges: Partial<Record<SopRatioKey, number>> = {};
	let hasChanges = false;

	for (const key of SOP_RATIO_KEYS) {
		if (changes[key] !== undefined) {
			safeChanges[key] = changes[key];
			if (prev.ratios[key] !== changes[key]) hasChanges = true;
		}
	}

	if (!hasChanges) {
		return { deactivatedPrev: null, profile: prev, audit: null } as CreateNewVersionResult<T>;
	}

	const newRatios = { ...prev.ratios, ...safeChanges };

	const profile = catalogDoc(
		'sop_profile',
		2,
		{
			name: prev.name,
			ratios: newRatios,
			version: prev.version + 1,
			active: true
		},
		createdBy
	) as SopMasterProfile;

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

	const deactivatedPrev: SopMasterProfile = {
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
			1,
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

export function createNewOverrideVersion(
	prev: SopOverrideProfile,
	changes: Partial<Record<SopRatioKey, number>>,
	reason: string,
	ctx: AuthorContext
): CreateNewVersionResult<SopOverrideProfile> {
	const safeChanges: Partial<Record<SopRatioKey, number>> = {};
	let hasChanges = false;

	for (const key of SOP_RATIO_KEYS) {
		if (changes[key] !== undefined) {
			safeChanges[key] = changes[key];
			if (prev.ratios[key] !== changes[key]) hasChanges = true;
		}
	}

	if (!hasChanges) {
		return { deactivatedPrev: null, profile: prev, audit: null };
	}

	const newRatios = { ...prev.ratios, ...safeChanges };

	const profile = makeDoc(
		'sop_override',
		1,
		{
			base_profile_id: prev.base_profile_id,
			name: prev.name,
			ratios: newRatios,
			version: prev.version + 1,
			active: true
		},
		ctx
	) as SopOverrideProfile;

	sopOverrideSchema.parse(profile);

	const audit = createAuditEntry(
		{
			action: 'manual_adjust',
			target_type: 'sop_override',
			target_id: profile._id,
			reason,
			context: { previous_version: prev.version, previous_id: prev._id, changes: safeChanges }
		},
		ctx
	);

	const deactivatedPrev: SopOverrideProfile = { ...touch(prev), active: false };

	return { deactivatedPrev, profile, audit };
}
