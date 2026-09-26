import { describe, it, expect } from 'vitest';
import {
	formatThaiDateTime,
	formatThaiTime,
	formatThaiDate,
	daysBetween,
	buildDateRange
} from './date';

describe('date utilities', () => {
	describe('formatThaiDateTime', () => {
		it('formats valid ISO datetime string into Thai formatted date and time', () => {
			const iso = '2026-07-04T14:30:00.000Z';
			const formatted = formatThaiDateTime(iso);
			expect(formatted).toBeDefined();
			expect(typeof formatted).toBe('string');
			// Should contain Thai year (2569 for 2026) or Thai month
			expect(formatted).toMatch(/2569/);
			expect(formatted).toMatch(/ก.ค./);
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
		it('formats valid ISO datetime string into time string', () => {
			const iso = '2026-07-04T14:30:00.000Z';
			const formatted = formatThaiTime(iso);
			expect(formatted).toBeDefined();
			expect(typeof formatted).toBe('string');
			expect(formatted).toMatch(/\d{1,2}:\d{2}/);
		});

		it('safely handles empty string or undefined-like inputs', () => {
			expect(formatThaiTime('')).toBe('');
		});

		it('safely falls back to raw string on invalid date formats', () => {
			const invalid = 'not-a-valid-date';
			expect(formatThaiTime(invalid)).toBe(invalid);
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
