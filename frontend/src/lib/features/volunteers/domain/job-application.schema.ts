/**
 * Job application domain schema — CR-094 §3.4 (schema.md §2.18, `job_application`
 * schema_v 1 → 2).
 *
 * Pure TypeScript / Zod — no I/O, no PouchDB, no Svelte.
 */

import { z } from 'zod';
import { makeDoc, type AuthorContext, type BaseDoc } from '$lib/db/model';
import { nationalIdSchema } from './volunteer.schema';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** CR-094 §3.4 — replaces `pending`/`accepted`; `rejected` is kept (not dropped by CR-092). */
export const jobApplicationStatusSchema = z.enum([
	'pending_review',
	'confirmed',
	'rejected',
	'cancelled'
]);
export type JobApplicationStatus = z.infer<typeof jobApplicationStatusSchema>;

export const applicantSchema = z.object({
	first_name: z.string().min(1),
	last_name: z.string().min(1),
	phone: z.string().min(1),
	phone_hash: z.string().min(1),
	email: z.string().nullable(),
	skills: z.array(z.string()),
	/** CR-094 §3.4 — captured on the No-SMS OTP quick-apply form, optional everywhere. */
	national_id: nationalIdSchema.nullable().optional()
});
export type Applicant = z.infer<typeof applicantSchema>;

export const selectedShiftSchema = z.object({
	date: z.string().min(1),
	start_time: z.string().min(1),
	end_time: z.string().min(1)
});
export type SelectedShift = z.infer<typeof selectedShiftSchema>;

// ---------------------------------------------------------------------------
// Document schema
// ---------------------------------------------------------------------------

export interface JobApplication extends BaseDoc {
	type: 'job_application';
	schema_v: 2;
	job_id: string;
	volunteer_id: string | null;
	applicant: Applicant;
	selected_shift: SelectedShift;
	tracking_token: string;
	status: JobApplicationStatus;
	review_notes?: string | null;
	reviewed_at?: string | null;
	reviewed_by?: string | null;
}

export const jobApplicationSchema = z.object({
	_id: z.string().startsWith('job_application:'),
	_rev: z.string().optional(),
	type: z.literal('job_application'),
	schema_v: z.literal(2),
	shelter_code: z.string().min(1),
	created_at: z.string(),
	updated_at: z.string(),
	created_by: z.string().min(1),
	job_id: z.string().startsWith('job:'),
	volunteer_id: z.string().startsWith('volunteer:').nullable(),
	applicant: applicantSchema,
	selected_shift: selectedShiftSchema,
	tracking_token: z.string().min(1),
	status: jobApplicationStatusSchema,
	review_notes: z.string().nullable().optional(),
	reviewed_at: z.string().nullable().optional(),
	reviewed_by: z.string().nullable().optional()
});

export const isJobApplication = (d: unknown): d is JobApplication =>
	jobApplicationSchema.safeParse(d).success;

// ---------------------------------------------------------------------------
// Creation input
// ---------------------------------------------------------------------------

export const jobApplicationInputSchema = z.object({
	job_id: z.string().startsWith('job:', 'กรุณาเลือกงาน'),
	volunteer_id: z.string().startsWith('volunteer:').nullable().default(null),
	applicant: applicantSchema,
	selected_shift: selectedShiftSchema,
	tracking_token: z.string().min(1)
});
export type JobApplicationInput = z.infer<typeof jobApplicationInputSchema>;

/**
 * Build a new `job_application`. Initial `status` is the caller's call (see
 * `skills.ts#initialStatusForSkills` — controlled skills must land on
 * `pending_review`, never `confirmed`).
 */
export function makeJobApplication(
	input: JobApplicationInput,
	ctx: AuthorContext,
	status: JobApplicationStatus
): JobApplication {
	const d = jobApplicationInputSchema.parse(input);
	return makeDoc(
		'job_application',
		2,
		{
			job_id: d.job_id,
			volunteer_id: d.volunteer_id,
			applicant: d.applicant,
			selected_shift: d.selected_shift,
			tracking_token: d.tracking_token,
			status,
			review_notes: null,
			reviewed_at: null,
			reviewed_by: null
		},
		ctx
	) as JobApplication;
}
