import { z } from 'zod';
import { type BaseDoc, makeDoc, type AuthorContext, now } from '$lib/db/model';
import { createAuditEntry, type AuditEntry } from '../../shared/domain/audit';

export const SOP_RATIO_KEYS = [
	'water_l_per_person_day',
	'rice_g_per_person_meal',
	'toilet_per_person'
] as const;

export type SopRatioKey = typeof SOP_RATIO_KEYS[number];

/**
 * Validates that all keys in the record are part of the whitelist
 * and that all values are positive numbers.
 */
export const ratiosSchema = z.record(
	z.enum(SOP_RATIO_KEYS),
	z.number().positive().optional()
).refine((r) => Object.values(r).some((v) => v !== undefined), { message: 'At least one ratio must be specified' });

export const sopRatioProfileSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('sop_profile'),
	schema_v: z.number().int().positive(),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1),
	name: z.string().min(1),
	ratios: ratiosSchema,
	version: z.number().int().positive(),
	active: z.boolean()
});

export type SopRatioProfile = z.infer<typeof sopRatioProfileSchema>;

export const isSopRatioProfile = (d: unknown): d is SopRatioProfile =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'sop_profile';

/**
 * Creates the initial version of a new SOP Ratio Profile.
 */
export function createInitialProfile(
	name: string,
	ratios: Partial<Record<SopRatioKey, number>>,
	ctx: AuthorContext
): { profile: SopRatioProfile; audit: AuditEntry } {
	// Filter out any unexpected keys for safety
	const safeRatios: Partial<Record<SopRatioKey, number>> = {};
	for (const key of SOP_RATIO_KEYS) {
		if (ratios[key] !== undefined) {
			safeRatios[key] = ratios[key];
		}
	}

	const profile = makeDoc(
		'sop_profile',
		1,
		{
			name,
			ratios: safeRatios,
			version: 1,
			active: true
		},
		ctx
	) as SopRatioProfile;

	// Validate against the schema invariants (values > 0, valid keys)
	sopRatioProfileSchema.parse(profile);

	const audit = createAuditEntry(
		{
			action: 'other',
			target_type: 'sop_profile',
			target_id: profile._id,
			reason: 'Initial creation',
			context: {
				ratios: profile.ratios
			}
		},
		ctx
	);

	return { profile, audit };
}

export type CreateNewVersionResult =
	| { deactivatedPrev: SopRatioProfile; profile: SopRatioProfile; audit: AuditEntry }
	| { deactivatedPrev: null; profile: SopRatioProfile; audit: null };

/**
 * Creates a new version of an existing SOP Ratio Profile.
 * This is an immutable operation; the previous profile is not modified.
 * It also returns an AuditEntry representing the change.
 * If changes yield an identical state, it aborts gracefully as an idempotent no-op.
 */
export function createNewVersion(
	prev: SopRatioProfile,
	changes: Partial<Record<SopRatioKey, number>>,
	reason: string,
	ctx: AuthorContext
): CreateNewVersionResult {
	// Filter incoming changes to ensure no poisoned keys leak into the merge
	const safeChanges: Partial<Record<SopRatioKey, number>> = {};
	let hasChanges = false;

	for (const key of SOP_RATIO_KEYS) {
		if (changes[key] !== undefined) {
			safeChanges[key] = changes[key];
			if (prev.ratios[key] !== changes[key]) {
				hasChanges = true;
			}
		}
	}

	if (!hasChanges) {
		return { deactivatedPrev: null, profile: prev, audit: null };
	}

	// Merge old and new ratios safely
	const newRatios = { ...prev.ratios, ...safeChanges };

	const profile = makeDoc(
		'sop_profile',
		1,
		{
			name: prev.name,
			ratios: newRatios,
			version: prev.version + 1,
			active: true
		},
		ctx
	) as SopRatioProfile;

	// Validate against the schema invariants
	sopRatioProfileSchema.parse(profile);

	// Generate audit entry for the change
	const audit = createAuditEntry(
		{
			action: 'manual_adjust',
			target_type: 'sop_profile',
			target_id: profile._id,
			reason,
			context: {
				previous_version: prev.version,
				previous_id: prev._id,
				changes: safeChanges
			}
		},
		ctx
	);

	// Deactivate the previous profile immutably
	const deactivatedPrev: SopRatioProfile = {
		...prev,
		active: false,
		updated_at: now()
	};

	return { deactivatedPrev, profile, audit };
}
