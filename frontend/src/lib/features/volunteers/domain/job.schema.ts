/**
 * Job domain schema — CR-094 §3.3 (schema.md §2.17, `job` schema_v 1 → 2).
 *
 * Pure TypeScript / Zod — no I/O, no PouchDB, no Svelte.
 *
 * Invariant (CR-094 §3.3, enforced by `quota.ts`, not here):
 *   slots_confirmed + slots_dispatched + slots_remaining === quota
 */

import { z } from 'zod';
import { makeDoc, type AuthorContext, type BaseDoc } from '$lib/db/model';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const jobTierSchema = z.enum(['operational', 'staff-capable']);
export type JobTier = z.infer<typeof jobTierSchema>;

/** CR-094 §3.3 — adds `draft` (job board WIP) and `paused` (temporarily not accepting). */
export const jobStatusSchema = z.enum([
	'draft',
	'open',
	'paused',
	'almost_full',
	'full',
	'closed',
	'cancelled'
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Statuses a public job board is allowed to show (CR-094 FR-VOL-13.2). */
export const PUBLIC_JOB_STATUSES: readonly JobStatus[] = ['open', 'almost_full'];

export const shiftTemplateSchema = z.object({
	shift_name: z.string().min(1),
	start_time: z.string().min(1),
	end_time: z.string().min(1),
	days: z.array(z.string()).optional()
});
export type ShiftTemplate = z.infer<typeof shiftTemplateSchema>;

// ---------------------------------------------------------------------------
// Document schema
// ---------------------------------------------------------------------------

export interface Job extends BaseDoc {
	type: 'job';
	schema_v: 2;
	title: string;
	description: string;
	tier: JobTier;
	required_roles: string[];
	skills_required?: string[];
	quota: number;
	slots_confirmed: number;
	/** CR-094 §3.3 — replaces `slots_pending`: offered, awaiting accept/decline (🟡). */
	slots_dispatched: number;
	/** CR-094 §3.3 — `quota - slots_confirmed - slots_dispatched` (⚪). */
	slots_remaining: number;
	shift_template: ShiftTemplate;
	auto_accept: boolean;
	status: JobStatus;
	/** CR-094 §3.3 — chip "ด่วนพิเศษ". */
	is_urgent: boolean;
}

export const jobSchema = z
	.object({
		_id: z.string().startsWith('job:'),
		_rev: z.string().optional(),
		type: z.literal('job'),
		schema_v: z.literal(2),
		shelter_code: z.string().min(1),
		created_at: z.string(),
		updated_at: z.string(),
		created_by: z.string().min(1),
		title: z.string().min(1),
		description: z.string().min(1),
		tier: jobTierSchema,
		required_roles: z.array(z.string()).default([]),
		skills_required: z.array(z.string()).optional(),
		quota: z.number().int().positive(),
		slots_confirmed: z.number().int().nonnegative(),
		slots_dispatched: z.number().int().nonnegative(),
		slots_remaining: z.number().int().nonnegative(),
		shift_template: shiftTemplateSchema,
		auto_accept: z.boolean(),
		status: jobStatusSchema,
		is_urgent: z.boolean()
	})
	// F-AUTO (CR-041, reaffirmed CR-094 FR-VOL-09.5): auto_accept only on operational tier.
	.refine((d) => !d.auto_accept || d.tier === 'operational', {
		message: 'auto_accept เปิดได้เฉพาะงานระดับ operational เท่านั้น',
		path: ['auto_accept']
	})
	// F8 — schema.md §2.17 Invariant: slots_confirmed + slots_dispatched + slots_remaining === quota.
	.refine((d) => d.slots_confirmed + d.slots_dispatched + d.slots_remaining === d.quota, {
		message: 'slots_confirmed + slots_dispatched + slots_remaining ต้องเท่ากับ quota เสมอ',
		path: ['slots_remaining']
	});

export const isJob = (d: unknown): d is Job => jobSchema.safeParse(d).success;

// ---------------------------------------------------------------------------
// Creation input
// ---------------------------------------------------------------------------

export const jobInputSchema = z
	.object({
		title: z.string().trim().min(1, 'กรุณากรอกชื่องาน'),
		description: z.string().trim().min(1, 'กรุณากรอกรายละเอียดงาน'),
		tier: jobTierSchema,
		required_roles: z.array(z.string()).default([]),
		skills_required: z.array(z.string()).default([]),
		quota: z.number().int().positive('จำนวนที่ต้องการต้องมากกว่า 0'),
		shift_template: shiftTemplateSchema,
		auto_accept: z.boolean().default(false),
		is_urgent: z.boolean().default(false)
	})
	.refine((d) => !d.auto_accept || d.tier === 'operational', {
		message: 'auto_accept เปิดได้เฉพาะงานระดับ operational เท่านั้น',
		path: ['auto_accept']
	});
export type JobInput = z.infer<typeof jobInputSchema>;

/**
 * New jobs start `open` — schema.md §2.17 default, reaffirmed by the owner
 * decision of 2026-08-26 (plan appendix). `draft` stays a value the SM form
 * can pick explicitly; it is not the default. Quota is fully unclaimed.
 */
export function makeJob(input: JobInput, ctx: AuthorContext): Job {
	const d = jobInputSchema.parse(input);
	return makeDoc(
		'job',
		2,
		{
			title: d.title,
			description: d.description,
			tier: d.tier,
			required_roles: d.required_roles,
			skills_required: d.skills_required,
			quota: d.quota,
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: d.quota,
			shift_template: d.shift_template,
			auto_accept: d.auto_accept,
			status: 'open',
			is_urgent: d.is_urgent
		},
		ctx
	) as Job;
}
