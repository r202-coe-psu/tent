/**
 * Shift assignment domain schema — CR-094 §3.2 (schema.md §2.9, `shift_assignment`
 * schema_v 2 → 3).
 *
 * Pure TypeScript / Zod — no I/O, no PouchDB, no Svelte.
 */

import { z } from 'zod';
import { makeDoc, type AuthorContext, type BaseDoc } from '$lib/db/model';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** CR-094 §3.2 — adds `flex` (standby, no fixed window); `custom` keeps a manual window. */
export const shiftKindSchema = z.enum(['morning', 'afternoon', 'night', 'flex', 'custom']);
export type ShiftKind = z.infer<typeof shiftKindSchema>;

/** CR-094 §3.2 — adds `standby`; renames `done` → `completed`. */
export const shiftAssignmentStatusSchema = z.enum([
	'assigned',
	'standby',
	'checked_in',
	'completed',
	'no_show',
	'cancelled'
]);
export type ShiftAssignmentStatus = z.infer<typeof shiftAssignmentStatusSchema>;

export const dispatchStatusSchema = z.enum(['dispatched', 'accepted', 'declined']);
export type DispatchStatus = z.infer<typeof dispatchStatusSchema>;

export const checkInMethodSchema = z.enum(['qr', 'manual_override']);
export type CheckInMethod = z.infer<typeof checkInMethodSchema>;

/**
 * F10 — `start_ts`/`end_ts` must be real ISO-8601 UTC datetimes (not just any
 * non-empty string), and `start_ts` must precede `end_ts`. A schema this weak
 * silently disables `domain/collision.ts`'s time-collision guard (garbage in,
 * no collision detected, double-booking waved through).
 */
export const dutyWindowSchema = z
	.object({
		start_ts: z.string().datetime(),
		end_ts: z.string().datetime()
	})
	.refine((d) => new Date(d.start_ts).getTime() < new Date(d.end_ts).getTime(), {
		message: 'duty_window.start_ts ต้องมาก่อน end_ts',
		path: ['end_ts']
	});
export type DutyWindow = z.infer<typeof dutyWindowSchema>;

/**
 * CR-094 §3.2 — standard 8h templates, expressed in **Asia/Bangkok
 * (UTC+7) local wall-clock hours** (F1 — the stored `duty_window` is UTC,
 * converted from this local template by `duty-window.ts#resolveDutyWindow`):
 * morning 08:00–16:00, afternoon 16:00–00:00 (crosses local midnight), night
 * 00:00–08:00. `flex` and `custom` have no template — their `duty_window` is
 * set explicitly by the caller (`flex` = standby, no fixed window at all).
 */
export const SHIFT_WINDOWS: Readonly<
	Record<'morning' | 'afternoon' | 'night', { startHour: number; durationHours: number }>
> = Object.freeze({
	morning: { startHour: 8, durationHours: 8 },
	afternoon: { startHour: 16, durationHours: 8 },
	night: { startHour: 0, durationHours: 8 }
});

// ---------------------------------------------------------------------------
// Document schema
// ---------------------------------------------------------------------------

export interface ShiftAssignment extends BaseDoc {
	type: 'shift_assignment';
	schema_v: 3;
	/** F12 — `job:{ulid}`, or the migration sentinel `'legacy'` (schema.md §2.9 v1 → v2 migration note). */
	job_id: string;
	volunteer_id: string;
	date: string;
	shift: ShiftKind;
	station: string;
	duty_window: DutyWindow;
	check_in_at?: string | null;
	check_out_at?: string | null;
	check_in_by?: string | null;
	status: ShiftAssignmentStatus;
	/** CR-094 §3.2 — set while a dispatch offer is outstanding / being decided. */
	dispatch_status?: DispatchStatus | null;
	/** CR-094 §3.2 — default `qr`; `manual_override` requires `check_in_reason`. */
	check_in_method: CheckInMethod;
	/** CR-094 §3.2 — required when `check_in_method === 'manual_override'` (FR-VOL-11.2). */
	check_in_reason: string | null;
}

/** F12 — schema.md §2.9 v1 → v2 migration writes `job_id: 'legacy'` on rows that predate the `job` link; new writes must still use `job:{ulid}`. */
const jobIdSchema = z.string().refine((v) => v === 'legacy' || v.startsWith('job:'), {
	message: 'job_id ต้องขึ้นต้นด้วย job: (หรือเป็น "legacy" สำหรับข้อมูลเก่า)'
});

export const shiftAssignmentSchema = z
	.object({
		_id: z.string().startsWith('shift_assignment:'),
		_rev: z.string().optional(),
		type: z.literal('shift_assignment'),
		schema_v: z.literal(3),
		shelter_code: z.string().min(1),
		created_at: z.string(),
		updated_at: z.string(),
		created_by: z.string().min(1),
		job_id: jobIdSchema,
		volunteer_id: z.string().startsWith('volunteer:'),
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		shift: shiftKindSchema,
		station: z.string().min(1),
		duty_window: dutyWindowSchema,
		check_in_at: z.string().nullable().optional(),
		check_out_at: z.string().nullable().optional(),
		check_in_by: z.string().nullable().optional(),
		status: shiftAssignmentStatusSchema,
		dispatch_status: dispatchStatusSchema.nullable().optional(),
		check_in_method: checkInMethodSchema,
		check_in_reason: z.string().nullable()
	})
	.refine(
		(d) =>
			d.check_in_method !== 'manual_override' ||
			(typeof d.check_in_reason === 'string' && d.check_in_reason.trim().length > 0),
		{
			message: 'กรุณาระบุเหตุผลเมื่อเช็คอินแทน (Manual Override)',
			path: ['check_in_reason']
		}
	);

export const isShiftAssignment = (d: unknown): d is ShiftAssignment =>
	shiftAssignmentSchema.safeParse(d).success;

// ---------------------------------------------------------------------------
// Creation input
// ---------------------------------------------------------------------------

export const shiftAssignmentInputSchema = z.object({
	job_id: z.string().startsWith('job:', 'กรุณาเลือกงาน'),
	volunteer_id: z.string().startsWith('volunteer:', 'กรุณาเลือกอาสาสมัคร'),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD'),
	shift: shiftKindSchema,
	station: z.string().trim().min(1, 'กรุณาระบุจุดปฏิบัติงาน'),
	duty_window: dutyWindowSchema
});
export type ShiftAssignmentInput = z.infer<typeof shiftAssignmentInputSchema>;

/**
 * F9 — widened beyond `status`/`dispatch_status` so a caller can express:
 *   - walk-in instant check-in (FR-VOL-10.5): create the assignment WITH
 *     `check_in_at`/`check_in_by` already set, in the same transaction as the
 *     volunteer profile — no separate check-in call needed.
 *   - a manual override AT creation time (FR-VOL-11.1/11.2): set
 *     `check_in_method: 'manual_override'` + `check_in_reason` up front.
 * The built doc is run back through `shiftAssignmentSchema` before it is
 * returned, so the existing `.refine` (manual_override requires a reason)
 * still applies at creation time, not only when the doc is later read back.
 */
export interface MakeShiftAssignmentFields {
	status?: ShiftAssignmentStatus;
	dispatch_status?: DispatchStatus | null;
	check_in_at?: string | null;
	check_in_by?: string | null;
	check_in_method?: CheckInMethod;
	check_in_reason?: string | null;
}

export function makeShiftAssignment(
	input: ShiftAssignmentInput,
	ctx: AuthorContext,
	fields: MakeShiftAssignmentFields = {}
): ShiftAssignment {
	const d = shiftAssignmentInputSchema.parse(input);
	const check_in_method = fields.check_in_method ?? 'qr';
	const doc = makeDoc(
		'shift_assignment',
		3,
		{
			job_id: d.job_id,
			volunteer_id: d.volunteer_id,
			date: d.date,
			shift: d.shift,
			station: d.station,
			duty_window: d.duty_window,
			check_in_at: fields.check_in_at ?? null,
			check_out_at: null,
			check_in_by: fields.check_in_by ?? null,
			status: fields.status ?? 'assigned',
			dispatch_status: fields.dispatch_status ?? null,
			check_in_method,
			check_in_reason:
				check_in_method === 'manual_override' ? (fields.check_in_reason ?? null) : null
		},
		ctx
	);
	return shiftAssignmentSchema.parse(doc) as ShiftAssignment;
}
