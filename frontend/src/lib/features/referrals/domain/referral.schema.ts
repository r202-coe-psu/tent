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
import { shelterCodeSchema } from '$lib/db/model';

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
	contact: z.string().optional(),
	/** M5 `facility_id` (TRF-001). Set on `dispatch_mode = m5` referrals only (schema_v 3). */
	m5_facility_id: z.number().int().positive().optional()
});
export type ToOrg = z.infer<typeof toOrgSchema>;

/** Required target external organisation for non-capacity referrals */
export const requiredToOrgSchema = toOrgSchema.extend({
	name: z.string().min(1, 'ชื่อหน่วยงานจำเป็นต้องระบุ')
});

// ---------------------------------------------------------------------------
// M5 hospital referral (draft CR — referral M5 integration §3, schema_v 3)
// ---------------------------------------------------------------------------

/** Missing = `tracking` (every v1/v2 doc). `m5` = dispatched through the M5 referral system. */
export const dispatchModeSchema = z.enum(['tracking', 'm5']);
export type DispatchMode = z.infer<typeof dispatchModeSchema>;

/** M5 triage colour per patient. Separate from `urgency`. */
export const acuitySchema = z.enum(['red', 'yellow', 'green', 'black']);
export type Acuity = z.infer<typeof acuitySchema>;

export const m5TransferStatusSchema = z.enum([
	'awaiting_review',
	'pending',
	'rejected',
	'in_transit',
	'arrived',
	'cancelled'
]);
export type M5TransferStatus = z.infer<typeof m5TransferStatusSchema>;

export const vehicleTypeSchema = z.enum(['ambulance', 'van', 'helicopter', 'other']);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

/** The shelter's own vehicle (M5 has no vehicle requests). */
export const referralTransportSchema = z.object({
	vehicle_type: vehicleTypeSchema,
	note: z.string().trim().max(500).optional()
});
export type ReferralTransport = z.infer<typeof referralTransportSchema>;

/** Snapshot of who MOPH and the hospital call back (M5 `requester`). */
export const requesterContactSchema = z.object({
	name: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ติดต่อ').max(120),
	role: z.string().trim().min(1, 'กรุณาระบุตำแหน่ง').max(60),
	phone: z.string().trim().min(1, 'กรุณาระบุเบอร์โทร').max(32)
});
export type RequesterContact = z.infer<typeof requesterContactSchema>;

export const m5ReviewSchema = z.object({
	note: z.string(),
	by: z.string().nullable(),
	at: z.string().nullable()
});

/** Link to the M5 transfer. The BFF writes it on send; the worker keeps it in sync. */
export const referralExternalSchema = z.object({
	system: z.literal('m5'),
	external_ref: z.string().min(1).max(64),
	code: z.string().min(1),
	status: m5TransferStatusSchema,
	original_m5_facility_id: z.number().int().optional(),
	review: m5ReviewSchema.optional(),
	last_synced_at: z.string().datetime().optional()
});
export type ReferralExternal = z.infer<typeof referralExternalSchema>;

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

export const evacueeSummarySchema = z.object({
	first_name: z.string().min(1),
	// May be empty: registration accepts a mononym (people `last_name` defaults to ''), so the
	// summary snapshot must too, or such evacuees cannot be referred.
	last_name: z.string(),
	gender: z.string().optional()
});
export type EvacueeSummary = z.infer<typeof evacueeSummarySchema>;

// ---------------------------------------------------------------------------
// Discriminated union schemas for Referral Documents
// ---------------------------------------------------------------------------

/**
 * Read-side schema_v range (CR-167 FR-C4, FR-C7; M5 draft CR §Migration). The reader accepts
 * v1–v3. Writers stamp v2, and v3 only on `dispatch_mode = m5` referrals (D15) — see
 * `M5_REFERRAL_SCHEMA_V`. Do not narrow this back to a literal.
 */
export const referralSchemaVSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const referralBaseSchema = z.object({
	_id: z.string().startsWith('referral:'),
	_rev: z.string().optional(),
	type: z.literal('referral'),
	schema_v: referralSchemaVSchema,
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1),
	evacuee_id: z.string().startsWith('evacuee:'),
	evacuee_summary: evacueeSummarySchema.optional(),
	reason: z
		.string()
		.min(1, 'Reason is required')
		.max(2000, 'Reason must not exceed 2000 characters'),
	response_reason: z
		.string()
		.max(2000, 'Response reason must not exceed 2000 characters')
		.optional(),
	close_reason: z.string().max(2000, 'Close reason must not exceed 2000 characters').optional(),
	urgency: referralUrgencySchema,
	status: referralStatusSchema,
	timeline: referralTimelineSchema,
	notes: z.string().max(2000, 'Notes must not exceed 2000 characters').optional()
});

/** Capacity referral: requires to_shelter_code */
export const capacityReferralSchema = referralBaseSchema.extend({
	referral_type: z.literal('capacity'),
	to_shelter_code: shelterCodeSchema,
	to_org: toOrgSchema.optional()
});

/** Resource referral: requires to_org with name */
export const resourceReferralSchema = referralBaseSchema.extend({
	referral_type: z.literal('resource'),
	to_shelter_code: z.string().optional(),
	to_org: requiredToOrgSchema
});

/**
 * Medical emergency referral: requires to_org with name. The M5 fields (schema_v 3) are all
 * optional on read; the batch input schema enforces them when a batch is created.
 */
export const medicalReferralSchema = referralBaseSchema.extend({
	referral_type: z.literal('medical-emergency'),
	to_shelter_code: z.string().optional(),
	to_org: requiredToOrgSchema,
	dispatch_mode: dispatchModeSchema.optional(),
	batch_id: z.string().min(1).optional(),
	acuity: acuitySchema.optional(),
	transport: referralTransportSchema.optional(),
	requester_contact: requesterContactSchema.optional(),
	external: referralExternalSchema.optional()
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

export const capacityInputSchema = z
	.object({
		...baseInput,
		referral_type: z.literal('capacity'),
		to_shelter_code: shelterCodeSchema,
		to_org: toOrgSchema.optional()
	})
	.refine(
		(data) => {
			// Runtime check: to_shelter_code must differ from current shelter
			// Actual validation enforced at server level with shelterCode context
			return data.to_shelter_code ? data.to_shelter_code.length > 0 : false;
		},
		{
			message: 'ไม่สามารถส่งต่อผู้ประสบภัยไปยังศูนย์พักพิงเดียวกันได้',
			path: ['to_shelter_code']
		}
	);

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
// Query / Filter Schemas
// ---------------------------------------------------------------------------

export const referralDirectionFilterSchema = z.enum(['outgoing', 'incoming']);

export const referralFilterSchema = z.object({
	status: referralStatusSchema.optional(),
	evacuee_id: z.string().optional(),
	limit: z.number().int().positive().max(1000).default(50),
	skip: z.number().int().nonnegative().default(0),
	sort: z.enum(['created_at_desc', 'created_at_asc']).default('created_at_desc'),
	/** Omitted = legacy `$or` over both directions (used for `evacuee_id` lookups). */
	direction: referralDirectionFilterSchema.optional(),
	/** Opaque Mango bookmark from the previous page; never combined with `skip`. */
	bookmark: z.string().max(2000).optional(),
	/** Server-side role limit (D16): only these referral types. Never from the query string. */
	referral_types: z.array(referralTypeSchema).optional()
});

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Query string of `GET /api/back-office/referral`. Empty values count as absent; `limit` must be
 * an integer in 1–200 (default 50). Anything else is rejected (the BFF answers 400).
 */
export const referralListQuerySchema = z.object({
	limit: z
		.string()
		.regex(/^\d+$/, 'limit must be an integer')
		.transform(Number)
		.pipe(z.number().int().min(1).max(MAX_LIST_LIMIT))
		.optional()
		.transform((n) => n ?? DEFAULT_LIST_LIMIT),
	bookmark: z.string().max(2000).optional(),
	status: referralStatusSchema.optional(),
	direction: referralDirectionFilterSchema.optional(),
	sort: z.enum(['created_at_desc', 'created_at_asc']).optional(),
	evacuee_id: z.string().optional()
});

export type ReferralDirectionFilter = z.infer<typeof referralDirectionFilterSchema>;

/** One server page of the referral list (Mango bookmark paging). */
export type ReferralPage = {
	items: Referral[];
	bookmark: string | null;
	hasMore: boolean;
};

export type ReferralFilter = z.input<typeof referralFilterSchema>;
export type ParsedReferralFilter = z.infer<typeof referralFilterSchema>;

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
export function buildReferralBody(input: ReferralInput, evacueeSummary?: EvacueeSummary) {
	const base = {
		evacuee_id: input.evacuee_id,
		evacuee_summary: evacueeSummary,
		reason: input.reason,
		urgency: input.urgency,
		status: 'draft' as const,
		timeline: {},
		notes: input.notes
	};

	switch (input.referral_type) {
		case 'capacity':
			return {
				...base,
				referral_type: 'capacity' as const,
				to_shelter_code: input.to_shelter_code,
				to_org: undefined
			};
		case 'resource':
		case 'medical-emergency':
			return {
				...base,
				referral_type: input.referral_type,
				to_shelter_code: undefined,
				to_org: input.to_org
			};
		default: {
			const _exhaustive: never = input;
			throw new Error(
				`Unknown referral type: ${(_exhaustive as { referral_type: string }).referral_type}`
			);
		}
	}
}
