/**
 * shift-edit.ts — validation rules for editing ONE existing sub-shift.
 *
 * Pure TypeScript — no I/O, no Svelte. Shared by the two places a shift can be
 * edited so they can never drift: the standalone dialog on the job detail
 * "กะและตารางกะ" tab, and the inline row editor inside the job create/edit
 * form dialog.
 *
 * Adding shifts is `shift-batch.ts`; this module only covers changing one that
 * already exists.
 */

import { defaultShiftEndDate, isDuplicateShift } from './shift-batch';
import type { JobShift } from './job.schema';

export interface ShiftEditDraft {
	date: string;
	start_time: string;
	end_time: string;
	quota: number;
}

export interface ShiftEditResult {
	/** Resolved `end_date` — the next day when the shift crosses midnight. */
	endDate: string;
	/** Thai message for the first rule broken, or `null` when the draft is valid. */
	error: string | null;
}

/**
 * @param siblings every OTHER shift of the job — never the row being edited,
 *   or the duplicate check matches itself and nothing can ever be saved.
 * @param minQuota seats the shift already holds (confirmed + dispatched).
 *   Cutting below it is rejected here because `JobRepository#update` would
 *   refuse the write anyway, and a rejection after the editor closed reads as
 *   a silent failure.
 */
export function validateShiftEdit(
	draft: ShiftEditDraft,
	siblings: readonly Pick<JobShift, 'date' | 'start_time' | 'end_time'>[],
	minQuota = 0
): ShiftEditResult {
	if (!draft.date) return { endDate: '', error: 'กรุณาเลือกวันที่ปฏิบัติงาน' };

	// `defaultShiftEndDate` throws `ShiftBatchError` on an unparseable date. A
	// half-typed date is a validation failure, not a crash — callers render
	// this result during a keystroke.
	let endDate: string;
	try {
		endDate = defaultShiftEndDate(draft.date, draft.start_time, draft.end_time);
	} catch {
		return { endDate: draft.date, error: 'วันที่ไม่ถูกต้อง' };
	}

	if (!Number.isInteger(draft.quota) || draft.quota < 1) {
		return { endDate, error: 'จำนวนคนต่อกะต้องเป็นจำนวนเต็มอย่างน้อย 1' };
	}
	if (`${endDate}T${draft.end_time}` <= `${draft.date}T${draft.start_time}`) {
		return { endDate, error: 'เวลาสิ้นสุดกะต้องอยู่หลังเวลาเริ่มกะ' };
	}
	if (draft.quota < minQuota) {
		return { endDate, error: `กะนี้มีอาสาถือที่นั่งอยู่แล้ว ${minQuota} คน — ลดต่ำกว่านี้ไม่ได้` };
	}
	if (
		isDuplicateShift(
			{ date: draft.date, start_time: draft.start_time, end_time: draft.end_time },
			siblings
		)
	) {
		return { endDate, error: 'มีกะวันและเวลานี้อยู่แล้วในงานนี้' };
	}
	return { endDate, error: null };
}

/** Apply a validated draft onto the original row, keeping its `id`. */
export function applyShiftEdit(
	original: JobShift,
	draft: ShiftEditDraft,
	endDate: string
): JobShift {
	return {
		...original,
		date: draft.date,
		end_date: endDate,
		start_time: draft.start_time,
		end_time: draft.end_time,
		quota: draft.quota
	};
}
