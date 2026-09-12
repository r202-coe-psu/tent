import { describe, it, expect } from 'vitest';
import {
	resolveDutyWindow,
	isWithinDutyWindow,
	DEFAULT_GRACE_MINUTES,
	DutyWindowError,
	shiftDutyWindow,
	sameDutyWindow
} from './duty-window';

// CR-094 §3.2 / schema.md §2.9 — shift templates are Asia/Bangkok (UTC+7, no
// DST) wall-clock: morning 08:00–16:00, afternoon 16:00–00:00(+1d), night
// 00:00–08:00, all *local*. These tests pin the persisted UTC instants that
// correspond to that local wall-clock contract — this is a correction of the
// original (buggy) UTC-literal behaviour, not a spec change.
describe('resolveDutyWindow', () => {
	it('morning (08:00-16:00 Bangkok) persists as 01:00-09:00 UTC, same calendar day', () => {
		expect(resolveDutyWindow('2026-08-26', 'morning')).toEqual({
			start_ts: '2026-08-26T01:00:00.000Z',
			end_ts: '2026-08-26T09:00:00.000Z'
		});
	});

	it('afternoon (16:00-00:00 Bangkok) persists as 09:00-17:00 UTC, same calendar day', () => {
		// 00:00 Bangkok the next local day is 17:00Z the same UTC calendar day
		// (24:00 - 7h = 17:00) — it does not cross the UTC date boundary at all.
		expect(resolveDutyWindow('2026-08-26', 'afternoon')).toEqual({
			start_ts: '2026-08-26T09:00:00.000Z',
			end_ts: '2026-08-26T17:00:00.000Z'
		});
	});

	it('night (00:00-08:00 Bangkok) starts 17:00Z on the PREVIOUS calendar day', () => {
		expect(resolveDutyWindow('2026-08-26', 'night')).toEqual({
			start_ts: '2026-08-25T17:00:00.000Z',
			end_ts: '2026-08-26T01:00:00.000Z'
		});
	});

	it('returns null for flex (no fixed window)', () => {
		expect(resolveDutyWindow('2026-08-26', 'flex')).toBeNull();
	});

	it('returns null for custom (caller supplies the window)', () => {
		expect(resolveDutyWindow('2026-08-26', 'custom')).toBeNull();
	});

	it('throws a typed DutyWindowError (not a raw RangeError) for a malformed date', () => {
		expect(() => resolveDutyWindow('not-a-date', 'morning')).toThrow(DutyWindowError);
		expect(() => resolveDutyWindow('2026-13-40', 'morning')).toThrow(DutyWindowError);
	});
});

describe('isWithinDutyWindow', () => {
	const morning = resolveDutyWindow('2026-08-26', 'morning')!;

	it('a volunteer standing in the shelter at 08:30 Bangkok on their morning shift is INSIDE the window', () => {
		// 08:30 Bangkok == 01:30Z — squarely inside the persisted morning window.
		expect(isWithinDutyWindow('2026-08-26T01:30:00.000Z', morning)).toBe(true);
	});

	it('is true inside the window', () => {
		expect(isWithinDutyWindow('2026-08-26T05:00:00.000Z', morning)).toBe(true);
	});

	it('is true exactly at start - 5min (grace boundary, inclusive)', () => {
		expect(isWithinDutyWindow('2026-08-26T00:55:00.000Z', morning)).toBe(true);
	});

	it('is false 1 second before the start-grace boundary', () => {
		expect(isWithinDutyWindow('2026-08-26T00:54:59.000Z', morning)).toBe(false);
	});

	it('is true exactly at end + 5min (grace boundary, inclusive)', () => {
		expect(isWithinDutyWindow('2026-08-26T09:05:00.000Z', morning)).toBe(true);
	});

	it('is false 1 second after the end-grace boundary', () => {
		expect(isWithinDutyWindow('2026-08-26T09:05:01.000Z', morning)).toBe(false);
	});

	it('respects a custom grace period', () => {
		expect(isWithinDutyWindow('2026-08-26T00:50:00.000Z', morning, 10)).toBe(true);
		expect(isWithinDutyWindow('2026-08-26T00:50:00.000Z', morning, DEFAULT_GRACE_MINUTES)).toBe(
			false
		);
	});

	it('handles the afternoon shift — 16:59 UTC just inside, 17:06 UTC outside grace', () => {
		const afternoon = resolveDutyWindow('2026-08-26', 'afternoon')!;
		expect(isWithinDutyWindow('2026-08-26T16:59:00.000Z', afternoon)).toBe(true);
		expect(isWithinDutyWindow('2026-08-26T17:04:00.000Z', afternoon)).toBe(true);
		expect(isWithinDutyWindow('2026-08-26T17:06:00.000Z', afternoon)).toBe(false);
	});

	it('handles the night shift starting 17:00Z the previous calendar day', () => {
		const night = resolveDutyWindow('2026-08-26', 'night')!;
		expect(isWithinDutyWindow('2026-08-25T16:56:00.000Z', night)).toBe(true);
		expect(isWithinDutyWindow('2026-08-25T16:54:00.000Z', night)).toBe(false);
		expect(isWithinDutyWindow('2026-08-26T01:04:00.000Z', night)).toBe(true);
	});

	it('flex (null window) DENIES — a null window must fail closed, not open (CR-094 FR-VOL-05R.4)', () => {
		expect(isWithinDutyWindow('2026-01-01T00:00:00.000Z', null)).toBe(false);
	});
});

describe('shiftDutyWindow', () => {
	const base = {
		date: '2026-08-26',
		end_date: '2026-08-26',
		start_time: '09:00',
		end_time: '15:00'
	};

	it('converts an arbitrary Bangkok wall-clock span to UTC', () => {
		expect(shiftDutyWindow(base)).toEqual({
			start_ts: '2026-08-26T02:00:00.000Z',
			end_ts: '2026-08-26T08:00:00.000Z'
		});
	});

	it('keeps minutes, not just whole hours', () => {
		expect(shiftDutyWindow({ ...base, start_time: '08:30', end_time: '12:45' })).toEqual({
			start_ts: '2026-08-26T01:30:00.000Z',
			end_ts: '2026-08-26T05:45:00.000Z'
		});
	});

	it('agrees with the morning template for 08:00–16:00', () => {
		expect(shiftDutyWindow({ ...base, start_time: '08:00', end_time: '16:00' })).toEqual(
			resolveDutyWindow('2026-08-26', 'morning')
		);
	});

	it('uses end_date for a shift that crosses midnight', () => {
		expect(
			shiftDutyWindow({
				date: '2026-08-26',
				end_date: '2026-08-27',
				start_time: '16:00',
				end_time: '00:00'
			})
		).toEqual(resolveDutyWindow('2026-08-26', 'afternoon'));
	});

	it('rejects malformed times and dates rather than returning a garbage window', () => {
		expect(() => shiftDutyWindow({ ...base, start_time: '25:00' })).toThrow(DutyWindowError);
		expect(() => shiftDutyWindow({ ...base, end_time: '08:60' })).toThrow(DutyWindowError);
		expect(() => shiftDutyWindow({ ...base, start_time: '9:00' })).toThrow(DutyWindowError);
		expect(() => shiftDutyWindow({ ...base, date: '2026-02-29', end_date: '2026-02-29' })).toThrow(
			DutyWindowError
		);
	});

	it('rejects a zero-length or inverted span', () => {
		expect(() => shiftDutyWindow({ ...base, end_time: '09:00' })).toThrow(DutyWindowError);
		expect(() => shiftDutyWindow({ ...base, start_time: '15:00', end_time: '09:00' })).toThrow(
			DutyWindowError
		);
	});
});

describe('sameDutyWindow', () => {
	it('is true for two windows with identical instants', () => {
		const a = shiftDutyWindow({
			date: '2026-06-13',
			end_date: '2026-06-13',
			start_time: '08:00',
			end_time: '16:00'
		});
		const b = shiftDutyWindow({
			date: '2026-06-13',
			end_date: '2026-06-13',
			start_time: '08:00',
			end_time: '16:00'
		});
		expect(sameDutyWindow(a, b)).toBe(true);
	});

	it('is false when only one edge differs', () => {
		const a = shiftDutyWindow({
			date: '2026-06-13',
			end_date: '2026-06-13',
			start_time: '08:00',
			end_time: '16:00'
		});
		const b = shiftDutyWindow({
			date: '2026-06-13',
			end_date: '2026-06-13',
			start_time: '08:00',
			end_time: '17:00'
		});
		expect(sameDutyWindow(a, b)).toBe(false);
	});
});
