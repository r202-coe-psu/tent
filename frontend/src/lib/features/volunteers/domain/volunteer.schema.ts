/**
 * Volunteer domain schema — CR-094 §3.1 (schema.md §2.8, `volunteer` schema_v 1 → 2)
 * and CR-095 (schema.md §2.8, `volunteer` schema_v 2 → 3 — `personnel_type`).
 *
 * Pure TypeScript / Zod — no I/O, no PouchDB, no Svelte.
 */

import { z } from 'zod';
import { makeDoc, type AuthorContext, type BaseDoc } from '$lib/db/model';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const volunteerStatusSchema = z.enum(['active', 'inactive']);
export type VolunteerStatus = z.infer<typeof volunteerStatusSchema>;

/** CR-094 §3.1 — where the volunteer profile originated (drives the roster "source" filter). */
export const volunteerSourceSchema = z.enum(['public_apply', 'walk_in', 'staff_entry', 'transfer']);
export type VolunteerSource = z.infer<typeof volunteerSourceSchema>;

/** CR-095 — ชนิดบุคคล: อาสาสมัคร vs เจ้าหน้าที่ประจำ (drives "ชนิดบุคคล" toggle). */
export const personnelTypeSchema = z.enum(['volunteer', 'staff']);
export type PersonnelType = z.infer<typeof personnelTypeSchema>;

/** National ID: 13 digits, optional everywhere (CR-094 FR-VOL-10.2 amends CR-092 FR-VOL-01). */
export const nationalIdSchema = z
	.string()
	.trim()
	.regex(/^\d{13}$/, 'เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก');

// ---------------------------------------------------------------------------
// Document schema
// ---------------------------------------------------------------------------

export interface Volunteer extends BaseDoc {
	type: 'volunteer';
	schema_v: 3;
	first_name: string;
	last_name: string;
	nickname?: string;
	phone: string | null;
	phone_hash?: string | null;
	email?: string | null;
	skills: string[];
	organization?: string | null;
	tracking_token?: string | null;
	status: VolunteerStatus;
	user_name?: string | null;
	central_profile_id?: string | null;
	/** CR-094 §3.1 — SSOT identity link (evacuee/volunteer/staff), optional everywhere. */
	national_id?: string | null;
	/** CR-094 §3.1 — live on-shift flag, drives Time-Bound Write Access (FR-VOL-05R). */
	checked_in: boolean;
	/** CR-094 §3.1 — shelter the volunteer is presently posted at (set on check-in/transfer). */
	current_shelter_code?: string | null;
	/** CR-094 §3.1 — human-readable code `V-{NNN}`, counted per shelter (see volunteer-code.ts). */
	volunteer_code: string;
	/** CR-094 §3.1 — backs the "ยืนยันตัวตนแล้ว" badge. */
	identity_verified: boolean;
	source: VolunteerSource;
	/** CR-095 — backs the "ชนิดบุคคล" toggle, default `'volunteer'`. */
	personnel_type: PersonnelType;
}

export const volunteerSchema = z.object({
	_id: z.string().startsWith('volunteer:'),
	_rev: z.string().optional(),
	type: z.literal('volunteer'),
	schema_v: z.literal(3),
	shelter_code: z.string().min(1),
	created_at: z.string(),
	updated_at: z.string(),
	created_by: z.string().min(1),
	first_name: z.string().min(1),
	last_name: z.string().min(1),
	nickname: z.string().optional(),
	phone: z.string().nullable(),
	phone_hash: z.string().nullable().optional(),
	email: z.string().nullable().optional(),
	skills: z.array(z.string()).default([]),
	organization: z.string().nullable().optional(),
	tracking_token: z.string().nullable().optional(),
	status: volunteerStatusSchema,
	user_name: z.string().nullable().optional(),
	central_profile_id: z.string().nullable().optional(),
	national_id: nationalIdSchema.nullable().optional(),
	checked_in: z.boolean(),
	current_shelter_code: z.string().nullable().optional(),
	volunteer_code: z.string().min(1),
	identity_verified: z.boolean(),
	source: volunteerSourceSchema,
	personnel_type: personnelTypeSchema
});

export const isVolunteer = (d: unknown): d is Volunteer => volunteerSchema.safeParse(d).success;

// ---------------------------------------------------------------------------
// Creation input
// ---------------------------------------------------------------------------

export const volunteerInputSchema = z.object({
	first_name: z.string().trim().min(1, 'กรุณากรอกชื่อ'),
	last_name: z.string().trim().min(1, 'กรุณากรอกนามสกุล'),
	nickname: z.string().trim().optional(),
	phone: z.string().trim().nullable(),
	email: z.string().trim().nullable().optional(),
	skills: z.array(z.string()).default([]),
	organization: z.string().trim().nullable().optional(),
	national_id: nationalIdSchema.nullable().default(null),
	source: volunteerSourceSchema,
	personnel_type: personnelTypeSchema.default('volunteer')
});
export type VolunteerInput = z.input<typeof volunteerInputSchema>;

/**
 * Walk-in front-desk form shape (CR-094 FR-VOL-10.1). Narrower than
 * `volunteerInputSchema`: `phone` is required here (front-desk staff always
 * capture it in person), and `email`/`national_id` bind to plain text
 * `Input`s so they use `''` — not `null` — as "not provided", converted to
 * `null` at submission time.
 */
export const walkInVolunteerFormSchema = z.object({
	first_name: z.string().trim().min(1, 'กรุณากรอกชื่อ'),
	last_name: z.string().trim().min(1, 'กรุณากรอกนามสกุล'),
	phone: z.string().trim().min(1, 'กรุณากรอกเบอร์โทรศัพท์'),
	email: z.string().trim().email('อีเมลไม่ถูกต้อง').optional().or(z.literal('')),
	national_id: z
		.string()
		.trim()
		.refine((v) => v === '' || /^\d{13}$/.test(v), 'เลขบัตร ปชช. ต้องเป็นตัวเลข 13 หลักเท่านั้น')
});
export type WalkInVolunteerFormValues = z.infer<typeof walkInVolunteerFormSchema>;

/**
 * Build a new `volunteer` doc. `volunteer_code` and `status` are decided by the
 * caller (see `volunteer-code.ts` / `skills.ts`) — this factory only stamps the
 * envelope and CR-094 defaults (§6 migration: `checked_in=false`,
 * `identity_verified=false`, `current_shelter_code=null`).
 */
export function makeVolunteer(
	input: VolunteerInput,
	ctx: AuthorContext,
	fields: { volunteer_code: string; status?: VolunteerStatus }
): Volunteer {
	const d = volunteerInputSchema.parse(input);
	return makeDoc(
		'volunteer',
		3,
		{
			first_name: d.first_name,
			last_name: d.last_name,
			...(d.nickname ? { nickname: d.nickname } : {}),
			phone: d.phone,
			email: d.email ?? null,
			skills: d.skills,
			organization: d.organization ?? null,
			tracking_token: null,
			status: fields.status ?? 'active',
			user_name: null,
			central_profile_id: null,
			national_id: d.national_id,
			checked_in: false,
			current_shelter_code: null,
			volunteer_code: fields.volunteer_code,
			identity_verified: false,
			source: d.source,
			personnel_type: d.personnel_type
		},
		ctx
	) as Volunteer;
}
