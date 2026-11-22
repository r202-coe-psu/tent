import { z } from 'zod';

/**
 * Shelter close job (CR-243) — shared shapes of the durable close job: the stored
 * `shelter_close_job` doc fields, the status DTO the UI polls, and the toast copy per
 * `end_reason` (FR-29). Pure: no I/O.
 */

export const SHELTER_CLOSE_JOB_PHASES = [
	'people',
	'households',
	'sweep',
	'finalize',
	'done'
] as const;
export type ShelterCloseJobPhase = (typeof SHELTER_CLOSE_JOB_PHASES)[number];

export const SHELTER_CLOSE_JOB_STATUSES = [
	'queued',
	'running',
	'completed',
	'completed_with_errors'
] as const;
export type ShelterCloseJobStatus = (typeof SHELTER_CLOSE_JOB_STATUSES)[number];

export const SHELTER_CLOSE_END_REASONS = [
	'ok',
	'failed',
	'stale',
	'sweep_exhausted',
	'attempts_exhausted'
] as const;
export type ShelterCloseEndReason = (typeof SHELTER_CLOSE_END_REASONS)[number];

export type ShelterCloseJobMode = 'close' | 'backfill';

export interface ShelterCloseJobCounters {
	checked_out: number;
	cancelled: number;
	households_repaired: number;
	failed: number;
}

export interface ShelterCloseJobFailure {
	evacuee_id: string;
	error: string;
}

/** Position inside the current phase: last sort key handled, plus households already reported. */
export interface ShelterCloseJobCursor {
	after?: string;
	reported?: string[];
}

export const isShelterCloseJobActiveStatus = (status: string | null | undefined): boolean =>
	status === 'queued' || status === 'running';

/** FR-8 response of `close/jobs/[id]`. */
export const shelterCloseJobViewSchema = z.object({
	job_id: z.string(),
	shelter_code: z.string(),
	mode: z.enum(['close', 'backfill']),
	status: z.enum(SHELTER_CLOSE_JOB_STATUSES),
	phase: z.enum(SHELTER_CLOSE_JOB_PHASES),
	sweep_round: z.number().int().nonnegative(),
	counters: z.object({
		checked_out: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
		households_repaired: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative()
	}),
	/** CR-219 FR-7 snapshot taken when the job was created (the "Y" in "X / Y"). */
	preview: z.object({
		by_status: z.record(z.string(), z.number().int().nonnegative()),
		total: z.number().int().nonnegative()
	}),
	failures: z.array(z.object({ evacuee_id: z.string(), error: z.string() })),
	closed: z.boolean(),
	end_reason: z.enum(SHELTER_CLOSE_END_REASONS).optional(),
	created_at: z.string(),
	updated_at: z.string(),
	started_at: z.string().optional(),
	finished_at: z.string().optional()
});
export type ShelterCloseJobView = z.infer<typeof shelterCloseJobViewSchema>;

/** FR-6 `202` body. */
export const shelterCloseJobStartedSchema = z.object({ job_id: z.string() });
export type ShelterCloseJobStarted = z.infer<typeof shelterCloseJobStartedSchema>;

/** FR-5: GET close — preview plus `active_job` when a job is queued / running. */
export const shelterCloseActiveJobSchema = z.object({
	job_id: z.string(),
	status: z.enum(['queued', 'running'])
});
export type ShelterCloseActiveJob = z.infer<typeof shelterCloseActiveJobSchema>;

export function isShelterCloseJobActive(view: Pick<ShelterCloseJobView, 'status'>): boolean {
	return isShelterCloseJobActiveStatus(view.status);
}

export interface ShelterCloseJobOutcome {
	kind: 'success' | 'error';
	message: string;
}

/** FR-29: the toast shown once a job is terminal. */
export function describeShelterCloseJobOutcome(
	view: Pick<ShelterCloseJobView, 'status' | 'end_reason' | 'counters'>
): ShelterCloseJobOutcome {
	const { counters } = view;
	if (view.status === 'completed' || view.end_reason === 'ok') {
		return {
			kind: 'success',
			message: `ปิดศูนย์แล้ว · เช็คเอาต์ ${counters.checked_out} คน · ยกเลิก ${counters.cancelled} คน`
		};
	}
	switch (view.end_reason) {
		case 'stale':
			return {
				kind: 'error',
				message: 'งานปิดศูนย์หยุดไปนาน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อเริ่มใหม่'
			};
		case 'sweep_exhausted':
			return {
				kind: 'error',
				message: 'ยังมีคนค้างหลังตรวจครบ 3 รอบ — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ'
			};
		case 'attempts_exhausted':
			return {
				kind: 'error',
				message: 'งานถูกรับต่อเกินจำนวนที่กำหนด — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อเริ่มใหม่'
			};
		case 'failed':
		default:
			return {
				kind: 'error',
				message:
					counters.failed > 0
						? `ล้มเหลว ${counters.failed} คน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ`
						: 'ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ'
			};
	}
}
