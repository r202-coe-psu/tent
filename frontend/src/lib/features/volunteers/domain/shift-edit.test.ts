import { describe, it, expect } from 'vitest';
import { validateShiftEdit, applyShiftEdit, type ShiftEditDraft } from './shift-edit';
import type { JobShift } from './job.schema';

function draft(overrides: Partial<ShiftEditDraft> = {}): ShiftEditDraft {
	return { date: '2026-06-13', start_time: '08:00', end_time: '12:00', quota: 5, ...overrides };
}

const sibling = { date: '2026-06-14', start_time: '08:00', end_time: '12:00' };

describe('validateShiftEdit', () => {
	it('accepts a valid same-day draft', () => {
		expect(validateShiftEdit(draft(), [sibling])).toEqual({
			endDate: '2026-06-13',
			error: null
		});
	});

	it('rolls end_date to the next day when the shift crosses midnight', () => {
		const result = validateShiftEdit(draft({ start_time: '22:00', end_time: '06:00' }), []);
		expect(result).toEqual({ endDate: '2026-06-14', error: null });
	});

	it('requires a date', () => {
		expect(validateShiftEdit(draft({ date: '' }), [])).toEqual({
			endDate: '',
			error: 'กรุณาเลือกวันที่ปฏิบัติงาน'
		});
	});

	it('reports an unparseable date instead of throwing', () => {
		// Times must cross midnight to reach the date parse at all —
		// `defaultShiftEndDate` returns early when the end time is later.
		const result = validateShiftEdit(
			draft({ date: '2026-13-99', start_time: '22:00', end_time: '06:00' }),
			[]
		);
		expect(result.error).toBe('วันที่ไม่ถูกต้อง');
	});

	it('rejects a non-positive or fractional headcount', () => {
		expect(validateShiftEdit(draft({ quota: 0 }), []).error).toMatch(/อย่างน้อย 1/);
		expect(validateShiftEdit(draft({ quota: 2.5 }), []).error).toMatch(/อย่างน้อย 1/);
	});

	it('reads equal start/end times as a 24-hour overnight shift, not an error', () => {
		// `defaultShiftEndDate` rolls `end_date` forward whenever the end time is
		// not strictly later, so 08:00–08:00 is a full-day shift. The add-a-shift
		// path in `job-shifts-tab.svelte` accepts it on the same rule; editing
		// must not be stricter than creating.
		expect(validateShiftEdit(draft({ start_time: '08:00', end_time: '08:00' }), [])).toEqual({
			endDate: '2026-06-14',
			error: null
		});
	});

	it('refuses to cut below the seats the shift already holds', () => {
		const result = validateShiftEdit(draft({ quota: 2 }), [], 3);
		expect(result.error).toContain('3 คน');
		// Cutting down to exactly what is held is allowed.
		expect(validateShiftEdit(draft({ quota: 3 }), [], 3).error).toBeNull();
	});

	it('rejects a draft that collides with another shift', () => {
		const result = validateShiftEdit(draft({ date: '2026-06-14' }), [sibling]);
		expect(result.error).toBe('มีกะวันและเวลานี้อยู่แล้วในงานนี้');
	});

	it('does not treat the row being edited as a collision when it is left out of siblings', () => {
		// Same values as the original row, `siblings` excludes it → valid.
		expect(validateShiftEdit(draft(), []).error).toBeNull();
	});
});

describe('applyShiftEdit', () => {
	it('keeps the original id and overwrites the editable fields', () => {
		const original: JobShift = {
			id: 'js-1',
			date: '2026-06-13',
			end_date: '2026-06-13',
			start_time: '08:00',
			end_time: '12:00',
			quota: 5
		};
		const next = applyShiftEdit(original, draft({ quota: 8, end_time: '16:00' }), '2026-06-13');
		expect(next).toEqual({
			id: 'js-1',
			date: '2026-06-13',
			end_date: '2026-06-13',
			start_time: '08:00',
			end_time: '16:00',
			quota: 8
		});
		expect(original.quota).toBe(5);
	});
});
