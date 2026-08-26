/**
 * shift-batch.ts — expand a date range into one job sub-shift per selected
 * weekday ("สร้างเป็นช่วงวัน / Batch Generator" on the job form).
 *
 * Pure — no I/O, no Svelte, no `new Date()` of "now". Dates are plain
 * `YYYY-MM-DD` strings interpreted as Asia/Bangkok calendar dates, the same
 * convention `duty-window.ts` uses; the arithmetic is done on the UTC midnight
 * anchor of each date, which is offset-free and therefore safe.
 */

import type { JobShift } from './job.schema';

export class ShiftBatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ShiftBatchError';
	}
}

/** 0 = Sunday … 6 = Saturday — the week starts on Sunday, as the form renders it. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAYS: readonly { value: Weekday; label: string }[] = [
	{ value: 0, label: 'อาทิตย์ (Sun)' },
	{ value: 1, label: 'จันทร์ (Mon)' },
	{ value: 2, label: 'อังคาร (Tue)' },
	{ value: 3, label: 'พุธ (Wed)' },
	{ value: 4, label: 'พฤหัสบดี (Thu)' },
	{ value: 5, label: 'ศุกร์ (Fri)' },
	{ value: 6, label: 'เสาร์ (Sat)' }
];

export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS_MON_FRI: readonly Weekday[] = [1, 2, 3, 4, 5];
export const WEEKENDS: readonly Weekday[] = [0, 6];

/**
 * Upper bound on rows a single Generate press may produce. Without it, a
 * mistyped end date ("2036") silently mints thousands of shifts.
 */
export const MAX_BATCH_SHIFTS = 180;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const MS_PER_DAY = 86_400_000;

export interface ShiftBatchRequest {
	startDate: string;
	endDate: string;
	weekdays: readonly Weekday[];
	start_time: string;
	end_time: string;
	quota: number;
}

function anchor(date: string, field: string): number {
	if (!DATE_RE.test(date)) {
		throw new ShiftBatchError(`${field} ต้องอยู่ในรูปแบบ YYYY-MM-DD`);
	}
	const ms = new Date(`${date}T00:00:00.000Z`).getTime();
	if (Number.isNaN(ms)) throw new ShiftBatchError(`${field} ไม่ถูกต้อง: ${date}`);
	// `new Date('2026-02-29T…')` normalises to 2026-03-01 rather than failing.
	if (new Date(ms).toISOString().slice(0, 10) !== date) {
		throw new ShiftBatchError(`${field} ไม่มีอยู่จริงในปฏิทิน: ${date}`);
	}
	return ms;
}

/**
 * Every `YYYY-MM-DD` in `[startDate, endDate]` (both inclusive) whose weekday
 * is in `weekdays`. Throws `ShiftBatchError` on an invalid range, an empty
 * weekday selection, or a result larger than {@link MAX_BATCH_SHIFTS}.
 */
export function expandDateRange(
	startDate: string,
	endDate: string,
	weekdays: readonly Weekday[]
): string[] {
	const startMs = anchor(startDate, 'วันที่เริ่มสร้างกะ');
	const endMs = anchor(endDate, 'วันที่สิ้นสุดกะ');
	if (endMs < startMs) {
		throw new ShiftBatchError('วันที่สิ้นสุดกะต้องไม่อยู่ก่อนวันที่เริ่มสร้างกะ');
	}
	if (weekdays.length === 0) {
		throw new ShiftBatchError('กรุณาเลือกวันในสัปดาห์อย่างน้อย 1 วัน');
	}
	const wanted = new Set(weekdays);

	const totalDays = Math.round((endMs - startMs) / MS_PER_DAY) + 1;
	if (totalDays > 366) {
		throw new ShiftBatchError('ช่วงวันที่ยาวเกิน 1 ปี — กรุณาย่อยเป็นหลายชุด');
	}

	const dates: string[] = [];
	for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
		const d = new Date(ms);
		if (wanted.has(d.getUTCDay() as Weekday)) dates.push(d.toISOString().slice(0, 10));
	}
	if (dates.length > MAX_BATCH_SHIFTS) {
		throw new ShiftBatchError(
			`สร้างได้สูงสุด ${MAX_BATCH_SHIFTS} กะต่อครั้ง (ช่วงนี้ได้ ${dates.length} กะ) — กรุณาย่อยช่วงวัน`
		);
	}
	return dates;
}

/**
 * Expand a batch request into shift rows. `makeId` mints the stable row id
 * (injected so this stays pure and deterministic in tests).
 */
export function generateBatchShifts(
	request: ShiftBatchRequest,
	makeId: (index: number) => string
): JobShift[] {
	const { start_time, end_time, quota } = request;
	if (!TIME_RE.test(start_time)) throw new ShiftBatchError('เวลาเข้ากะต้องอยู่ในรูปแบบ HH:mm');
	if (!TIME_RE.test(end_time)) throw new ShiftBatchError('เวลาออกกะต้องอยู่ในรูปแบบ HH:mm');
	if (!Number.isInteger(quota) || quota <= 0) {
		throw new ShiftBatchError('จำนวนคนต่อกะต้องเป็นจำนวนเต็มมากกว่า 0');
	}

	return expandDateRange(request.startDate, request.endDate, request.weekdays).map(
		(date, index) => ({
			id: makeId(index),
			date,
			start_time,
			end_time,
			quota
		})
	);
}

/** Same date + start + end already present — used to skip duplicates on append. */
export function isDuplicateShift(
	candidate: Pick<JobShift, 'date' | 'start_time' | 'end_time'>,
	existing: readonly Pick<JobShift, 'date' | 'start_time' | 'end_time'>[]
): boolean {
	return existing.some(
		(s) =>
			s.date === candidate.date &&
			s.start_time === candidate.start_time &&
			s.end_time === candidate.end_time
	);
}

/**
 * Append `incoming` to `existing`, dropping exact duplicates.
 * Returns the merged list plus how many rows were added and skipped.
 */
export function appendShifts(
	existing: readonly JobShift[],
	incoming: readonly JobShift[]
): { shifts: JobShift[]; added: number; skipped: number } {
	const shifts = [...existing];
	let added = 0;
	let skipped = 0;
	for (const row of incoming) {
		if (isDuplicateShift(row, shifts)) {
			skipped++;
			continue;
		}
		shifts.push(row);
		added++;
	}
	return { shifts, added, skipped };
}
