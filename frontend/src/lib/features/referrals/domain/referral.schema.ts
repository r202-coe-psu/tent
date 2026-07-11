/**
 * T-34.1 — Referral domain schema
 *
 * Pure TypeScript / Zod — No I/O, No PouchDB, No Svelte.
 * Aligned with schema.md §2.11 and CR-D1 (External Only, R3 scope).
 *
 * CR-D1 scope: `to_org` = external organisation only (hospital, social_services, other).
 * Inter-shelter capacity transfer is deferred to R4.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const referralStatusSchema = z.enum(['draft', 'sent', 'accepted', 'rejected', 'closed']);
export type ReferralStatus = z.infer<typeof referralStatusSchema>;

export const referralUrgencySchema = z.enum(['normal', 'urgent']);
export type ReferralUrgency = z.infer<typeof referralUrgencySchema>;

/** Target external organisation (CR-D1: external only in R3) */
export const toOrgSchema = z.object({
	name: z.string().min(1, 'Organisation name is required'),
	kind: z.enum(['hospital', 'social_services', 'other']),
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
	to_org: toOrgSchema,
	reason: z.string().min(1, 'Reason is required'),
	urgency: referralUrgencySchema,
	status: referralStatusSchema,
	timeline: referralTimelineSchema,
	notes: z.string().optional()
});

export type Referral = z.infer<typeof referralSchema>;

/** Fields required to create a new referral draft. */
export const referralInputSchema = referralSchema.pick({
	evacuee_id: true,
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
