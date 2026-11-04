import { describe, expect, it } from 'vitest';
import type { JobShift } from './job.schema';
import {
	DEFAULT_SHIFT_TIMES,
	firstShiftCardError,
	newShiftCard,
	shiftCardErrors,
	updateShiftCard
} from './shift-draft';

function shift(overrides: Partial<JobShift> = {}): JobShift {
	return {
		id: 'js-1',
		date: '2026-10-20',
		end_date: '2026-10-20',
		start_time: '08:00',
		end_time: '16:00',
		quota: 5,
		...overrides
	};
}

describe('newShiftCard', () => {
	it('starts the first card undated with the default times and headcount', () => {
		expect(newShiftCard(undefined, 'js-a')).toEqual({
			id: 'js-a',
			date: '',
			end_date: '',
			...DEFAULT_SHIFT_TIMES
		});
	});

	it('copies the times and headcount of the card before it, not its date', () => {
		const previous = shift({ start_time: '16:00', end_time: '00:00', quota: 3 });
		expect(newShiftCard(previous, 'js-b')).toEqual({
			id: 'js-b',
			date: '',
			end_date: '',
			start_time: '16:00',
			end_time: '00:00',
			quota: 3
		});
	});
});

describe('updateShiftCard', () => {
	it('derives end_date from the date and times', () => {
		const card = newShiftCard(undefined, 'js-a');
		expect(updateShiftCard(card, { date: '2026-10-20' }).end_date).toBe('2026-10-20');
	});

	it('moves end_date to the next day when the shift crosses midnight', () => {
		expect(updateShiftCard(shift(), { start_time: '22:00', end_time: '06:00' }).end_date).toBe(
			'2026-10-21'
		);
	});

	it('keeps a hand-set end_date when only the headcount changes', () => {
		const long = shift({ end_date: '2026-10-22' });
		expect(updateShiftCard(long, { quota: 8 })).toEqual({ ...long, quota: 8 });
	});

	it('clears end_date when the date is cleared', () => {
		expect(updateShiftCard(shift(), { date: '' }).end_date).toBe('');
	});
});

describe('shiftCardErrors', () => {
	it('reports a missing date on the card that lacks one', () => {
		const cards = [shift(), newShiftCard(shift(), 'js-2')];
		expect(shiftCardErrors(cards)).toEqual({
			'js-1': null,
			'js-2': 'กรุณาเลือกวันที่ปฏิบัติงาน'
		});
	});

	it('flags both cards of a duplicate pair', () => {
		const errors = shiftCardErrors([shift({ id: 'a' }), shift({ id: 'b' })]);
		expect(errors.a).toMatch(/มีกะวันและเวลานี้อยู่แล้ว/);
		expect(errors.b).toMatch(/มีกะวันและเวลานี้อยู่แล้ว/);
	});

	it('checks new cards against shifts already saved on the job', () => {
		const errors = shiftCardErrors([shift({ id: 'new' })], {
			existing: [shift({ id: 'saved' })]
		});
		expect(errors.new).toMatch(/มีกะวันและเวลานี้อยู่แล้ว/);
	});

	it('rejects cutting a saved shift below the seats it already holds', () => {
		const errors = shiftCardErrors([shift({ quota: 2 })], { minQuotaById: { 'js-1': 3 } });
		expect(errors['js-1']).toMatch(/ถือที่นั่งอยู่แล้ว 3 คน/);
	});

	it('rejects a zero headcount', () => {
		expect(shiftCardErrors([shift({ quota: 0 })])['js-1']).toMatch(/อย่างน้อย 1/);
	});
});

describe('firstShiftCardError', () => {
	it('names the first broken card by its position', () => {
		const cards = [shift({ id: 'a' }), shift({ id: 'b', date: '' })];
		expect(firstShiftCardError(cards, shiftCardErrors(cards))).toBe(
			'กะที่ 2: กรุณาเลือกวันที่ปฏิบัติงาน'
		);
	});

	it('is null when every card is valid', () => {
		const cards = [shift()];
		expect(firstShiftCardError(cards, shiftCardErrors(cards))).toBeNull();
	});
});
