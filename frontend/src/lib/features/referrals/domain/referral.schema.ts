/**
 * T-34.1 — Referral domain schema
 *
 * Pure TypeScript / Zod — No I/O, No PouchDB, No Svelte.
 * Aligned with schema.md §2.11 & Option A (Full T-34 DoD).
 *
 * Supports 3 referral kinds via Zod Discriminated Union:
 * - `capacity`: inter-shelter transfer due to capacity limits.
 * - `resource`: requesting external/inter-shelter resource support.
 * - `medical-emergency`: medical referral to healthcare organization.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const referralTypeSchema = z.enum(['capacity', 'resource', 'medical-emergency']);
export type ReferralType = z.infer<typeof referralTypeSchema>;

export const referralStatusSchema = z.enum(['draft', 'sent', 'accepted', 'rejected', 'closed']);
export type ReferralStatus = z.infer<typeof referralStatusSchema>;

export const referralUrgencySchema = z.enum(['normal', 'urgent']);
export type ReferralUrgency = z.infer<typeof referralUrgencySchema>;

/** Target external organisation (optional fields for legacy/capacity compatibility) */
export const toOrgSchema = z.object({
	name: z.string().optional(),
	kind: z.enum(['hospital', 'social_services', 'other']).optional(),
	contact: z.string().optional()
});
export type ToOrg = z.infer<typeof toOrgSchema>;

/** Required target external organisation for non-capacity referrals */
export const requiredToOrgSchema = z.object({
	name: z.string().min(1, 'ชื่อหน่วยงานจำเป็นต้องระบุ'),
	kind: z.enum(['hospital', 'social_services', 'other']).optional(),
	contact: z.string().optional()
});

export const timelineStampSchema = z.object({
	at: z.string().datetime(),
	by: z.string().min(1)
});

export const referralTimelineSchema = z.object({
	sent: timelineStampSchema.optional(),
	responded: timelineStampSchema.optional(),
	closed: timelineStampSchema.optional()
});
export type ReferralTimeline = z.infer<typeof referralTimelineSchema>;

// ---------------------------------------------------------------------------
// Discriminated union schemas for Referral Documents
// ---------------------------------------------------------------------------

const referralBaseSchema = z.object({
	_id: z.string().startsWith('referral:'),
	_rev: z.string().optional(),
	type: z.literal('referral'),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1),
	evacuee_id: z.string().startsWith('evacuee:'),
	reason: z
		.string()
		.min(1, 'Reason is required')
		.max(2000, 'Reason must not exceed 2000 characters'),
	response_reason: z
		.string()
		.max(2000, 'Response reason must not exceed 2000 characters')
		.optional(),
	urgency: referralUrgencySchema,
	status: referralStatusSchema,
	timeline: referralTimelineSchema,
	notes: z.string().max(2000, 'Notes must not exceed 2000 characters').optional()
});

/** Capacity referral: requires to_shelter_code */
export const capacityReferralSchema = referralBaseSchema.extend({
	referral_type: z.literal('capacity'),
	to_shelter_code: z.string().min(1, 'Target shelter code is required'),
	to_org: toOrgSchema.optional()
});

/** Resource referral: requires to_org with name */
export const resourceReferralSchema = referralBaseSchema.extend({
	referral_type: z.literal('resource'),
	to_shelter_code: z.string().optional(),
	to_org: requiredToOrgSchema
});

/** Medical emergency referral: requires to_org with name */
export const medicalReferralSchema = referralBaseSchema.extend({
	referral_type: z.literal('medical-emergency'),
	to_shelter_code: z.string().optional(),
	to_org: requiredToOrgSchema
});

/** Discriminated union for strict referral documents */
export const referralSchema = z.discriminatedUnion('referral_type', [
	capacityReferralSchema,
	resourceReferralSchema,
	medicalReferralSchema
]);

/** Lenient read schema for backward compatibility with legacy CouchDB docs */
export const legacyReferralSchema = referralBaseSchema.extend({
	referral_type: referralTypeSchema.default('medical-emergency'),
	to_shelter_code: z.string().optional(),
	to_org: toOrgSchema.optional()
});

export const referralReadSchema = z.union([
	capacityReferralSchema,
	resourceReferralSchema,
	medicalReferralSchema,
	legacyReferralSchema
]);

export type CapacityReferral = z.infer<typeof capacityReferralSchema>;
export type ResourceReferral = z.infer<typeof resourceReferralSchema>;
export type MedicalReferral = z.infer<typeof medicalReferralSchema>;
export type Referral = z.infer<typeof referralReadSchema>;

// ---------------------------------------------------------------------------
// Creation Input Schemas (discriminated union)
// ---------------------------------------------------------------------------

const baseInput = {
	evacuee_id: z.string().startsWith('evacuee:', 'กรุณาเลือกผู้ประสบภัย'),
	reason: z
		.string()
		.min(1, 'Reason is required')
		.max(2000, 'Reason must not exceed 2000 characters'),
	urgency: referralUrgencySchema,
	notes: z.string().max(2000, 'Notes must not exceed 2000 characters').optional()
};

export const capacityInputSchema = z.object({
	...baseInput,
	referral_type: z.literal('capacity'),
	to_shelter_code: z.string().min(1, 'กรุณาระบุรหัสศูนย์พักพิงปลายทาง'),
	to_org: toOrgSchema.optional()
});

export const resourceInputSchema = z.object({
	...baseInput,
	referral_type: z.literal('resource'),
	to_shelter_code: z.string().optional(),
	to_org: requiredToOrgSchema
});

export const medicalInputSchema = z.object({
	...baseInput,
	referral_type: z.literal('medical-emergency'),
	to_shelter_code: z.string().optional(),
	to_org: requiredToOrgSchema
});

export const rawReferralInputSchema = z.discriminatedUnion('referral_type', [
	capacityInputSchema,
	resourceInputSchema,
	medicalInputSchema
]);

export const referralInputSchema = z.preprocess((val) => {
	if (val && typeof val === 'object' && !('referral_type' in val)) {
		return { ...val, referral_type: 'medical-emergency' };
	}
	return val;
}, rawReferralInputSchema);

export type ReferralInput = z.infer<typeof rawReferralInputSchema>;

// ---------------------------------------------------------------------------
// Type guards & Helpers
// ---------------------------------------------------------------------------

export const isReferral = (d: unknown): d is Referral => referralReadSchema.safeParse(d).success;

export function isCapacityReferral(r: Referral): r is CapacityReferral {
	return r.referral_type === 'capacity';
}

export function isResourceReferral(r: Referral): r is ResourceReferral {
	return r.referral_type === 'resource';
}

export function isMedicalReferral(r: Referral): r is MedicalReferral {
	return r.referral_type === 'medical-emergency';
}

/**
 * Shared factory function to construct a new draft referral body.
 */
export function buildReferralBody(input: ReferralInput) {
	if (input.referral_type === 'capacity') {
		return {
			evacuee_id: input.evacuee_id,
			referral_type: 'capacity' as const,
			to_shelter_code: input.to_shelter_code,
			to_org: undefined,
			reason: input.reason,
			urgency: input.urgency,
			status: 'draft' as const,
			timeline: {},
			notes: input.notes
		};
	} else if (input.referral_type === 'resource') {
		return {
			evacuee_id: input.evacuee_id,
			referral_type: 'resource' as const,
			to_shelter_code: undefined,
			to_org: input.to_org,
			reason: input.reason,
			urgency: input.urgency,
			status: 'draft' as const,
			timeline: {},
			notes: input.notes
		};
	} else {
		return {
			evacuee_id: input.evacuee_id,
			referral_type: 'medical-emergency' as const,
			to_shelter_code: undefined,
			to_org: input.to_org,
			reason: input.reason,
			urgency: input.urgency,
			status: 'draft' as const,
			timeline: {},
			notes: input.notes
		};
	}
}
