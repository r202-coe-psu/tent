/**
 * Volunteer transfer domain schema — CR-094 §3.5 (new doc type, schema_v 1).
 *
 * Pure TypeScript / Zod — no I/O, no PouchDB, no Svelte.
 */

import { z } from 'zod';
import { makeDoc, type AuthorContext, type BaseDoc } from '$lib/db/model';

export const volunteerTransferStatusSchema = z.enum([
	'pending',
	'accepted',
	'rejected',
	'cancelled'
]);
export type VolunteerTransferStatus = z.infer<typeof volunteerTransferStatusSchema>;

export interface VolunteerTransfer extends BaseDoc {
	type: 'volunteer_transfer';
	schema_v: 1;
	volunteer_id: string;
	from_shelter_code: string;
	to_shelter_code: string;
	reason?: string | null;
	status: VolunteerTransferStatus;
	requested_by: string;
	decided_by?: string | null;
	decided_at?: string | null;
}

// F17 — `from_shelter_code !== to_shelter_code` is a sensible guard, but it is
// NOT written anywhere in CR-094 §3.5 or schema.md §2.20 — it is an addition
// made in this slice, pending a CR note to make it official spec. Do not
// mistake this refine for something schema.md already requires.
export const volunteerTransferSchema = z
	.object({
		_id: z.string().startsWith('volunteer_transfer:'),
		_rev: z.string().optional(),
		type: z.literal('volunteer_transfer'),
		schema_v: z.literal(1),
		shelter_code: z.string().min(1),
		created_at: z.string(),
		updated_at: z.string(),
		created_by: z.string().min(1),
		volunteer_id: z.string().startsWith('volunteer:'),
		from_shelter_code: z.string().min(1),
		to_shelter_code: z.string().min(1),
		reason: z.string().nullable().optional(),
		status: volunteerTransferStatusSchema,
		requested_by: z.string().min(1),
		decided_by: z.string().nullable().optional(),
		decided_at: z.string().nullable().optional()
	})
	.refine((d) => d.from_shelter_code !== d.to_shelter_code, {
		message: 'ไม่สามารถขอโอนย้ายไปยังศูนย์เดิมได้',
		path: ['to_shelter_code']
	});

export const isVolunteerTransfer = (d: unknown): d is VolunteerTransfer =>
	volunteerTransferSchema.safeParse(d).success;

// ---------------------------------------------------------------------------
// Creation input
// ---------------------------------------------------------------------------

export const volunteerTransferInputSchema = z
	.object({
		volunteer_id: z.string().startsWith('volunteer:', 'กรุณาเลือกอาสาสมัคร'),
		from_shelter_code: z.string().trim().min(1),
		to_shelter_code: z.string().trim().min(1, 'กรุณาเลือกศูนย์ปลายทาง'),
		reason: z.string().trim().nullable().default(null)
	})
	// F17 — see the note on `volunteerTransferSchema` above: this rule is an
	// addition of this slice, not something CR-094 §3.5 / schema.md §2.20 spells out.
	.refine((d) => d.from_shelter_code !== d.to_shelter_code, {
		message: 'ไม่สามารถขอโอนย้ายไปยังศูนย์เดิมได้',
		path: ['to_shelter_code']
	});
export type VolunteerTransferInput = z.infer<typeof volunteerTransferInputSchema>;

export function makeVolunteerTransfer(
	input: VolunteerTransferInput,
	ctx: AuthorContext
): VolunteerTransfer {
	const d = volunteerTransferInputSchema.parse(input);
	return makeDoc(
		'volunteer_transfer',
		1,
		{
			volunteer_id: d.volunteer_id,
			from_shelter_code: d.from_shelter_code,
			to_shelter_code: d.to_shelter_code,
			reason: d.reason,
			status: 'pending' as const,
			requested_by: ctx.createdBy,
			decided_by: null,
			decided_at: null
		},
		ctx
	) as VolunteerTransfer;
}
