/**
 * T-34.1 — Referral domain schema
 *
 * Pure TypeScript / Zod — No I/O, No PouchDB, No Svelte.
 * Aligned with schema.md §2.11 & Option A (Full T-34 DoD).
 *
 * Supports 3 referral kinds:
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

/** Target external organisation (used when sending to hospital / social services) */
export const toOrgSchema = z.object({
	name: z.string().optional(),
	kind: z.enum(['hospital', 'social_services', 'other']).optional(),
	contact: z.string().optional()
});
export type ToOrg = z.infer<typeof toOrgSchema>;

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
// Main document schema
// ---------------------------------------------------------------------------

export const referralSchema = z.object({
	_id: z.string().startsWith('referral:'),
	_rev: z.string().optional(),
	type: z.literal('referral'),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1),

	evacuee_id: z.string().startsWith('evacuee:'),
	referral_type: referralTypeSchema.default('medical-emergency'),
	to_shelter_code: z.string().optional(),
	to_org: toOrgSchema.optional(),
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

export type Referral = z.infer<typeof referralSchema>;

/** Fields required to create a new referral draft. */
export const referralInputSchema = referralSchema.pick({
	evacuee_id: true,
	referral_type: true,
	to_shelter_code: true,
	to_org: true,
	reason: true,
	urgency: true,
	notes: true
});
export type ReferralInput = z.infer<typeof referralInputSchema>;

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export const isReferral = (d: unknown): d is Referral => referralSchema.safeParse(d).success;

/**
 * Shared factory function to construct a new draft referral body.
 */
export function buildReferralBody(input: ReferralInput) {
	return {
		evacuee_id: input.evacuee_id,
		referral_type: input.referral_type ?? 'medical-emergency',
		to_shelter_code: input.to_shelter_code,
		to_org: input.to_org,
		reason: input.reason,
		urgency: input.urgency,
		status: 'draft' as const,
		timeline: {},
		notes: input.notes
	};
}
