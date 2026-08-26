/**
 * Job domain schema — CR-094 §3.3 (schema.md §2.17, `job` schema_v 2 → 3).
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

/**
 * One concrete sub-shift of a job (schema_v 3) — a real calendar date with its
 * own start/end time and its own headcount. Replaces the single
 * `shift_template` + one flat `quota`, which could not express a job that runs
 * over several days with different capacities.
 *
 * `id` is stable for the lifetime of the row so the UI can key a removable
 * list by it, and so a `shift_assignment` can later point at a specific shift.
 */
export const jobShiftSchema = z.object({
	id: z.string().min(1),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD'),
	start_time: z.string().regex(/^\d{2}:\d{2}$/, 'เวลาต้องอยู่ในรูปแบบ HH:mm'),
	end_time: z.string().regex(/^\d{2}:\d{2}$/, 'เวลาต้องอยู่ในรูปแบบ HH:mm'),
	quota: z.number().int().positive('จำนวนรับต่อกะต้องมากกว่า 0')
});
export type JobShift = z.infer<typeof jobShiftSchema>;

/** Total headcount across every sub-shift — the job's `quota`. */
export function totalShiftQuota(shifts: readonly Pick<JobShift, 'quota'>[]): number {
	return shifts.reduce((sum, s) => sum + s.quota, 0);
}

// ---------------------------------------------------------------------------
// Document schema
// ---------------------------------------------------------------------------

export interface Job extends BaseDoc {
	type: 'job';
	schema_v: 3;
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
	/** schema_v 3 — concrete sub-shifts; `quota === sum(shifts[].quota)`. */
	shifts: JobShift[];
	/** @deprecated schema_v 3 — superseded by `shifts[]`; kept for docs written under schema_v 2. */
	shift_template?: ShiftTemplate;
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
		schema_v: z.literal(3),
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
		shifts: z.array(jobShiftSchema).min(1, 'ต้องมีกะย่อยอย่างน้อย 1 กะ'),
		shift_template: shiftTemplateSchema.optional(),
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
	})
	// schema_v 3 — `quota` is the sum of the sub-shift headcounts, never set by hand.
	.refine((d) => totalShiftQuota(d.shifts) === d.quota, {
		message: 'quota ต้องเท่ากับผลรวมจำนวนรับของกะย่อยทุกกะ',
		path: ['quota']
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
		/**
		 * Sub-shifts define the capacity — the job's `quota` is derived as their
		 * sum by `makeJob`, so there is no separate "total" field to keep in sync.
		 */
		shifts: z.array(jobShiftSchema).min(1, 'ต้องเพิ่มกะย่อยอย่างน้อย 1 กะ'),
		auto_accept: z.boolean().default(false),
		is_urgent: z.boolean().default(false),
		/**
		 * Publication state chosen on the form's LIFECYCLE STATUS control.
		 * `open` is the default (schema.md §2.17, owner decision 2026-08-26).
		 * `almost_full` is deliberately absent — it is only ever produced by
		 * `deriveJobStatus` from the quota fill level, and so is `full` after the
		 * next dispatch/accept/decline, even if it is picked here.
		 */
		status: z.enum(['draft', 'open', 'paused', 'full', 'closed']).default('open')
	})
	.refine((d) => !d.auto_accept || d.tier === 'operational', {
		message: 'auto_accept เปิดได้เฉพาะงานระดับ operational เท่านั้น',
		path: ['auto_accept']
	});
/**
 * The shape a CALLER supplies — `z.input`, not `z.infer`, so fields carrying a
 * `.default()` (`status`, `auto_accept`, `is_urgent`, the two arrays) stay
 * optional at the call site. `makeJob` parses before use, so the defaults are
 * always materialised on the stored document.
 */
export type JobInput = z.input<typeof jobInputSchema>;

/**
 * New jobs start `open` — schema.md §2.17 default, reaffirmed by the owner
 * decision of 2026-08-26 (plan appendix). `draft` stays a value the SM form
 * can pick explicitly; it is not the default. Quota is fully unclaimed.
 */
export function makeJob(input: JobInput, ctx: AuthorContext): Job {
	const d = jobInputSchema.parse(input);
	const quota = totalShiftQuota(d.shifts);
	return makeDoc(
		'job',
		3,
		{
			title: d.title,
			description: d.description,
			tier: d.tier,
			required_roles: d.required_roles,
			skills_required: d.skills_required,
			quota,
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: quota,
			shifts: d.shifts,
			auto_accept: d.auto_accept,
			status: d.status,
			is_urgent: d.is_urgent
		},
		ctx
	) as Job;
}
