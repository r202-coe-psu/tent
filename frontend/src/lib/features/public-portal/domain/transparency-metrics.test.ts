import { describe, expect, it } from 'vitest';
import {
	countVulnerableFromBirthYearRows,
	isValidThaiBirthYear,
	sumOccupancyFromStatusRows
} from './transparency-metrics';

describe('transparency metrics', () => {
	it('accepts only integer Buddhist Era birth years in the expected range', () => {
		expect(isValidThaiBirthYear(2563)).toBe(true);
		expect(isValidThaiBirthYear(2020)).toBe(false);
		expect(isValidThaiBirthYear(2600)).toBe(false);
		expect(isValidThaiBirthYear('2563')).toBe(false);
	});

	it('does not classify a Gregorian year as a vulnerable age', () => {
		expect(
			countVulnerableFromBirthYearRows(
				[null, { key: 2020, value: 6 }, { key: 2563, value: 5 }, { key: 2500, value: 2 }],
				2026
			)
		).toBe(2);
	});

	it('counts children and older adults from valid Buddhist Era years', () => {
		expect(
			countVulnerableFromBirthYearRows(
				[
					{ key: 2565, value: 3 },
					{ key: 2480, value: 4 },
					{ key: null, value: 10 },
					{ key: 2563, value: -1 }
				],
				2026
			)
		).toBe(7);
	});
});

describe('sumOccupancyFromStatusRows (CR-070 D-BOOK-OCC=C)', () => {
	it('counts active + pre_registered and ignores every other status', () => {
		const rows = [
			{ key: 'active', value: 3 },
			{ key: 'pre_registered', value: 2 },
			{ key: 'cancelled', value: 9 },
			{ key: 'checked_out', value: 4 },
			{ key: 'deceased', value: 1 }
		];
		expect(sumOccupancyFromStatusRows(rows)).toBe(5);
	});

	it('returns 0 when nothing holds a place', () => {
		expect(sumOccupancyFromStatusRows([{ key: 'cancelled', value: 9 }])).toBe(0);
		expect(sumOccupancyFromStatusRows([])).toBe(0);
	});

	it('tolerates a missing or malformed view payload', () => {
		expect(sumOccupancyFromStatusRows(undefined)).toBe(0);
		expect(sumOccupancyFromStatusRows(null)).toBe(0);
		expect(sumOccupancyFromStatusRows('nope')).toBe(0);
		expect(sumOccupancyFromStatusRows([null, 'x', 42])).toBe(0);
	});

	it('skips rows whose value is not a usable count', () => {
		const rows = [
			{ key: 'active', value: 3 },
			{ key: 'pre_registered', value: -1 },
			{ key: 'active', value: Number.NaN },
			{ key: 'active', value: '7' }
		];
		expect(sumOccupancyFromStatusRows(rows)).toBe(3);
	});
});
