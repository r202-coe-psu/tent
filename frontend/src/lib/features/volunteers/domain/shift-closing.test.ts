import { describe, expect, it } from 'vitest';
import { hasOpenShift, isShiftOpen, openJobsFirst, openShifts } from './shift-closing';

// Bangkok is UTC+7, so 2026-10-28T09:00+07:00 is 02:00Z.
const at = (iso: string) => new Date(`${iso}+07:00`);
const day = { date: '2026-10-28', start_time: '08:00', end_time: '16:00' };

describe('isShiftOpen', () => {
	it('is open before the shift starts', () => {
		expect(isShiftOpen(day, at('2026-10-27T20:00:00'))).toBe(true);
	});

	it('is open while the shift is running', () => {
		expect(isShiftOpen(day, at('2026-10-28T12:00:00'))).toBe(true);
	});

	it('closes the moment the shift ends', () => {
		expect(isShiftOpen(day, at('2026-10-28T15:59:59'))).toBe(true);
		expect(isShiftOpen(day, at('2026-10-28T16:00:00'))).toBe(false);
		expect(isShiftOpen(day, at('2026-10-29T08:00:00'))).toBe(false);
	});

	it('keeps a shift with no times and no usable date open', () => {
		expect(isShiftOpen({ date: '' }, at('2026-10-28T12:00:00'))).toBe(true);
		expect(isShiftOpen({ date: '', end_date: '' }, at('2026-10-28T12:00:00'))).toBe(true);
	});

	it('reads the clock in Bangkok, not UTC', () => {
		expect(isShiftOpen(day, new Date('2026-10-28T08:59:00Z'))).toBe(true);
		expect(isShiftOpen(day, new Date('2026-10-28T09:00:00Z'))).toBe(false);
	});

	it('ends an overnight shift on the next day', () => {
		const night = { date: '2026-10-28', start_time: '22:00', end_time: '06:00' };
		expect(isShiftOpen(night, at('2026-10-28T23:30:00'))).toBe(true);
		expect(isShiftOpen(night, at('2026-10-29T05:59:00'))).toBe(true);
		expect(isShiftOpen(night, at('2026-10-29T06:00:00'))).toBe(false);
	});

	it('trusts an explicit end_date', () => {
		const long = { ...day, end_date: '2026-10-30' };
		expect(isShiftOpen(long, at('2026-10-29T20:00:00'))).toBe(true);
		expect(isShiftOpen(long, at('2026-10-30T16:00:00'))).toBe(false);
	});

	it('closes a flex shift (no end time) at the end of its date', () => {
		const flex = { date: '2026-10-28', start_time: null, end_time: null };
		expect(isShiftOpen(flex, at('2026-10-28T23:59:00'))).toBe(true);
		expect(isShiftOpen(flex, at('2026-10-29T00:00:00'))).toBe(false);
	});

	it('keeps a malformed row open', () => {
		expect(isShiftOpen({ ...day, date: 'garbage' }, at('2026-10-28T20:00:00'))).toBe(true);
	});
});

describe('hasOpenShift / openShifts', () => {
	const past = { date: '2026-10-27', start_time: '08:00', end_time: '16:00' };
	const future = { date: '2026-10-29', start_time: '08:00', end_time: '16:00' };
	const now = at('2026-10-28T20:00:00');

	it('keeps only the shifts still open', () => {
		expect(openShifts([past, future], now)).toEqual([future]);
	});

	it('is closed only when every shift has ended', () => {
		expect(hasOpenShift({ shifts: [past, future] }, now)).toBe(true);
		expect(hasOpenShift({ shifts: [past] }, now)).toBe(false);
	});

	it('treats a job with no shift rows as open', () => {
		expect(hasOpenShift({}, now)).toBe(true);
		expect(hasOpenShift({ shifts: [] }, now)).toBe(true);
	});
});

describe('openJobsFirst', () => {
	it('puts closed jobs last and keeps each group in its own order', () => {
		const jobs = [
			{ id: 'a', open: false },
			{ id: 'b', open: true },
			{ id: 'c', open: false },
			{ id: 'd', open: true }
		];
		expect(openJobsFirst(jobs, (job) => job.open).map((job) => job.id)).toEqual([
			'b',
			'd',
			'a',
			'c'
		]);
	});
});
