import { describe, it, expect } from 'vitest';
import {
	formatThaiDateTime,
	formatThaiTime,
	formatThaiShortDate,
	formatThaiDate,
	daysBetween,
	buildDateRange,
	DISPLAY_LOCALE,
	DISPLAY_TIME_ZONE
} from './date';

describe('date utilities', () => {
	it('exports display locale and timezone constants', () => {
		expect(DISPLAY_LOCALE).toBe('th-TH');
		expect(DISPLAY_TIME_ZONE).toBe('Asia/Bangkok');
	});

	describe('formatThaiDateTime', () => {
		it('formats UTC ISO as Bangkok wall clock with Buddhist year', () => {
			// 14:30Z → 21:30 Asia/Bangkok
			const iso = '2026-07-04T14:30:00.000Z';
			const formatted = formatThaiDateTime(iso);
			expect(formatted).toMatch(/2569/);
			expect(formatted).toMatch(/ก\.ค\./);
			expect(formatted).toMatch(/21:30/);
		});

		it('safely handles empty string or undefined-like inputs', () => {
			expect(formatThaiDateTime('')).toBe('');
		});

		it('safely falls back to raw string on invalid date formats', () => {
			const invalid = 'not-a-valid-date';
			expect(formatThaiDateTime(invalid)).toBe(invalid);
		});
	});

	describe('formatThaiTime', () => {
		it('formats UTC ISO as Bangkok wall clock', () => {
			const iso = '2026-07-04T14:30:00.000Z';
			expect(formatThaiTime(iso)).toMatch(/21:30/);
		});

		it('safely handles empty string or undefined-like inputs', () => {
			expect(formatThaiTime('')).toBe('');
		});

		it('safely falls back to raw string on invalid date formats', () => {
			const invalid = 'not-a-valid-date';
			expect(formatThaiTime(invalid)).toBe(invalid);
		});
	});

	describe('formatThaiShortDate', () => {
		it('formats UTC ISO near midnight as Bangkok calendar day with Buddhist year', () => {
			// 2026-07-04T20:00Z → 2026-07-05 03:00 Bangkok → 5/7/2569
			const formatted = formatThaiShortDate('2026-07-04T20:00:00.000Z');
			expect(formatted).toMatch(/5/);
			expect(formatted).toMatch(/7/);
			expect(formatted).toMatch(/2569/);
		});
	});

	describe('formatThaiDate', () => {
		it('formats YYYY-MM-DD date strings', () => {
			expect(formatThaiDate('2026-07-07')).toBe('7 ก.ค.');
		});
	});

	describe('daysBetween', () => {
		it('calculates inclusive day difference', () => {
			expect(daysBetween('2026-07-01', '2026-07-05')).toBe(5);
		});
	});

	describe('buildDateRange', () => {
		it('builds array of date strings between range', () => {
			const range = buildDateRange('2026-07-01', '2026-07-03');
			expect(range).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
		});
	});
});
