import { describe, expect, it } from 'vitest';
import { countVulnerableFromBirthYearRows, isValidThaiBirthYear } from './transparency-metrics';

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
