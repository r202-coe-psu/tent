import { describe, it, expect } from 'vitest';
import {
	ALL_WEEKDAYS,
	MAX_BATCH_SHIFTS,
	ShiftBatchError,
	WEEKDAYS_MON_FRI,
	WEEKENDS,
	appendShifts,
	expandDateRange,
	generateBatchShifts,
	isDuplicateShift,
	type Weekday
} from './shift-batch';

const id = (i: number) => `shift-${i}`;

describe('expandDateRange', () => {
	it('includes both ends of the range', () => {
		// 2026-08-26 is a Wednesday
		expect(expandDateRange('2026-08-26', '2026-08-28', ALL_WEEKDAYS)).toEqual([
			'2026-08-26',
			'2026-08-27',
			'2026-08-28'
		]);
	});

	it('returns the single date when start === end', () => {
		expect(expandDateRange('2026-08-26', '2026-08-26', ALL_WEEKDAYS)).toEqual(['2026-08-26']);
	});

	it('keeps only the selected weekdays', () => {
		// 2026-08-26 Wed .. 2026-09-02 Wed
		expect(expandDateRange('2026-08-26', '2026-09-02', WEEKENDS)).toEqual([
			'2026-08-29', // Sat
			'2026-08-30' // Sun
		]);
		expect(expandDateRange('2026-08-26', '2026-09-02', WEEKDAYS_MON_FRI)).toEqual([
			'2026-08-26',
			'2026-08-27',
			'2026-08-28',
			'2026-08-31',
			'2026-09-01',
			'2026-09-02'
		]);
	});

	it('returns an empty list when no date in the range matches a selected weekday', () => {
		// Mon..Tue only, asking for the weekend
		expect(expandDateRange('2026-08-31', '2026-09-01', WEEKENDS)).toEqual([]);
	});

	it('rejects an inverted range', () => {
		expect(() => expandDateRange('2026-08-28', '2026-08-26', ALL_WEEKDAYS)).toThrow(
			ShiftBatchError
		);
	});

	it('rejects an empty weekday selection', () => {
		expect(() => expandDateRange('2026-08-26', '2026-08-28', [])).toThrow(ShiftBatchError);
	});

	it('rejects malformed and non-existent dates', () => {
		expect(() => expandDateRange('26/08/2026', '2026-08-28', ALL_WEEKDAYS)).toThrow(
			ShiftBatchError
		);
		// 2026 is not a leap year — Date would silently normalise this to 2026-03-01
		expect(() => expandDateRange('2026-02-29', '2026-03-05', ALL_WEEKDAYS)).toThrow(
			ShiftBatchError
		);
	});

	it('rejects a result larger than the row cap', () => {
		expect(() => expandDateRange('2026-01-01', '2026-12-31', ALL_WEEKDAYS)).toThrow(
			new RegExp(String(MAX_BATCH_SHIFTS))
		);
	});

	it('rejects a range longer than a year before it even counts rows', () => {
		expect(() => expandDateRange('2026-01-01', '2027-06-30', WEEKENDS)).toThrow(/ยาวเกิน 1 ปี/);
	});

	it('accepts exactly the row cap', () => {
		// 180 consecutive days -> exactly MAX_BATCH_SHIFTS rows
		const rows = expandDateRange('2026-01-01', '2026-06-29', ALL_WEEKDAYS);
		expect(rows.length).toBe(MAX_BATCH_SHIFTS);
	});
});

describe('generateBatchShifts', () => {
	const base = {
		startDate: '2026-08-26',
		endDate: '2026-08-28',
		weekdays: ALL_WEEKDAYS,
		start_time: '08:00',
		end_time: '16:00',
		quota: 5
	};

	it('mints one row per date carrying the shared time and headcount', () => {
		expect(generateBatchShifts(base, id)).toEqual([
			{ id: 'shift-0', date: '2026-08-26', start_time: '08:00', end_time: '16:00', quota: 5 },
			{ id: 'shift-1', date: '2026-08-27', start_time: '08:00', end_time: '16:00', quota: 5 },
			{ id: 'shift-2', date: '2026-08-28', start_time: '08:00', end_time: '16:00', quota: 5 }
		]);
	});

	it('rejects malformed times', () => {
		expect(() => generateBatchShifts({ ...base, start_time: '8:00' }, id)).toThrow(ShiftBatchError);
		expect(() => generateBatchShifts({ ...base, end_time: '' }, id)).toThrow(ShiftBatchError);
	});

	it('rejects a non-positive or fractional headcount', () => {
		expect(() => generateBatchShifts({ ...base, quota: 0 }, id)).toThrow(ShiftBatchError);
		expect(() => generateBatchShifts({ ...base, quota: -1 }, id)).toThrow(ShiftBatchError);
		expect(() => generateBatchShifts({ ...base, quota: 1.5 }, id)).toThrow(ShiftBatchError);
	});

	it('yields nothing when the weekday filter excludes the whole range', () => {
		expect(
			generateBatchShifts(
				{ ...base, startDate: '2026-08-31', endDate: '2026-09-01', weekdays: WEEKENDS },
				id
			)
		).toEqual([]);
	});
});

describe('appendShifts / isDuplicateShift', () => {
	const row = (date: string, start = '08:00', end = '16:00') => ({
		id: `id-${date}-${start}`,
		date,
		start_time: start,
		end_time: end,
		quota: 5
	});

	it('appends new rows and reports the count', () => {
		const result = appendShifts([row('2026-08-26')], [row('2026-08-27'), row('2026-08-28')]);
		expect(result.added).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.shifts.map((s) => s.date)).toEqual(['2026-08-26', '2026-08-27', '2026-08-28']);
	});

	it('skips a row whose date and both times already exist', () => {
		const result = appendShifts([row('2026-08-26')], [row('2026-08-26'), row('2026-08-27')]);
		expect(result).toMatchObject({ added: 1, skipped: 1 });
		expect(result.shifts.length).toBe(2);
	});

	it('treats the same date at a different time as a distinct shift', () => {
		const result = appendShifts(
			[row('2026-08-26', '08:00', '16:00')],
			[row('2026-08-26', '16:00', '00:00')]
		);
		expect(result).toMatchObject({ added: 1, skipped: 0 });
	});

	it('de-duplicates within the incoming batch itself', () => {
		const result = appendShifts([], [row('2026-08-26'), row('2026-08-26')]);
		expect(result).toMatchObject({ added: 1, skipped: 1 });
	});

	it('does not mutate the existing list', () => {
		const existing = [row('2026-08-26')];
		appendShifts(existing, [row('2026-08-27')]);
		expect(existing.length).toBe(1);
	});

	it('isDuplicateShift ignores quota differences', () => {
		const full = row('2026-08-26');
		const key = { date: full.date, start_time: full.start_time, end_time: full.end_time };
		const differentSeats = { ...full, quota: 99 };
		expect(isDuplicateShift(key, [differentSeats])).toBe(true);
	});
});

describe('weekday presets', () => {
	it('start the week on Sunday and cover all seven days exactly once', () => {
		expect(ALL_WEEKDAYS).toEqual([0, 1, 2, 3, 4, 5, 6] as Weekday[]);
		expect([...WEEKDAYS_MON_FRI, ...WEEKENDS].sort()).toEqual([...ALL_WEEKDAYS].sort());
	});
});
