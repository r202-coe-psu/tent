/**
 * Unit tests for dashboard-demographics domain/schema.ts
 *
 * Tests:
 *   1. rowsToAgeGroups — correct bucket mapping and defaulting to 0
 *   2. rowsToNationalities — arbitrary key grouping
 *   3. DemographicsPayloadSchema — rejects missing / negative fields
 *   4. ageBucketForBirthYear — new staff demographics bands
 */
import { describe, it, expect } from 'vitest';
import {
	ageBucketForBirthYear,
	rowsToAgeGroups,
	rowsToCountries,
	DemographicsPayloadSchema
} from './demographics.schema';

describe('ageBucketForBirthYear', () => {
	const y = 2026;

	it('buckets by the staff demographics ranges', () => {
		expect(ageBucketForBirthYear(y + 543 - 0, y)).toBe('<1');
		expect(ageBucketForBirthYear(y + 543 - 1, y)).toBe('1-5');
		expect(ageBucketForBirthYear(y + 543 - 5, y)).toBe('1-5');
		expect(ageBucketForBirthYear(y + 543 - 6, y)).toBe('6-11');
		expect(ageBucketForBirthYear(y + 543 - 11, y)).toBe('6-11');
		expect(ageBucketForBirthYear(y + 543 - 12, y)).toBe('12-19');
		expect(ageBucketForBirthYear(y + 543 - 19, y)).toBe('12-19');
		expect(ageBucketForBirthYear(y + 543 - 20, y)).toBe('20-59');
		expect(ageBucketForBirthYear(y + 543 - 59, y)).toBe('20-59');
		expect(ageBucketForBirthYear(y + 543 - 60, y)).toBe('60+');
	});

	it('returns unknown for missing or invalid birth years', () => {
		expect(ageBucketForBirthYear(null, y)).toBe('unknown');
		expect(ageBucketForBirthYear(undefined, y)).toBe('unknown');
		expect(ageBucketForBirthYear(y + 543 + 1, y)).toBe('unknown');
	});
});

describe('rowsToAgeGroups', () => {
	it('correctly maps all defined age buckets', () => {
		const rows = [
			{ key: '<1', value: 2 },
			{ key: '1-5', value: 3 },
			{ key: '6-11', value: 1 },
			{ key: '12-19', value: 4 },
			{ key: '20-59', value: 40 },
			{ key: '60+', value: 10 },
			{ key: 'unknown', value: 5 }
		];
		const result = rowsToAgeGroups(rows);
		expect(result['<1']).toBe(2);
		expect(result['1-5']).toBe(3);
		expect(result['6-11']).toBe(1);
		expect(result['12-19']).toBe(4);
		expect(result['20-59']).toBe(40);
		expect(result['60+']).toBe(10);
		expect(result.unknown).toBe(5);
	});

	it('defaults missing buckets to 0', () => {
		const result = rowsToAgeGroups([{ key: '20-59', value: 20 }]);
		expect(result['<1']).toBe(0);
		expect(result['60+']).toBe(0);
	});

	it('discards unknown bucket keys silently', () => {
		const result = rowsToAgeGroups([{ key: 'century', value: 1 }]);
		// 'century' is not in AGE_BUCKETS — all known buckets should be 0
		expect(result['20-59']).toBe(0);
	});

	it('returns all zeros for empty rows', () => {
		const result = rowsToAgeGroups([]);
		expect(Object.values(result).every((v) => v === 0)).toBe(true);
	});
});

describe('rowsToCountries', () => {
	it('builds a key→count record from view rows', () => {
		const rows = [
			{ key: 'THAILAND', value: 50 },
			{ key: 'MYANMAR', value: 20 },
			{ key: 'UNKNOWN', value: 3 }
		];
		const result = rowsToCountries(rows);
		expect(result['THAILAND']).toBe(50);
		expect(result['MYANMAR']).toBe(20);
		expect(result['UNKNOWN']).toBe(3);
	});

	it('returns empty object for no rows', () => {
		expect(rowsToCountries([])).toEqual({});
	});
});

describe('DemographicsPayloadSchema', () => {
	it('accepts a valid payload', () => {
		const valid = {
			shelter_code: 'SH001',
			age_groups: {
				'<1': 0,
				'1-5': 0,
				'6-11': 0,
				'12-19': 0,
				'20-59': 5,
				'60+': 0,
				unknown: 0
			},
			countries: { THAILAND: 5 }
		};
		expect(() => DemographicsPayloadSchema.parse(valid)).not.toThrow();
	});

	it('rejects missing age_groups', () => {
		const invalid = { shelter_code: 'SH001', countries: {} };
		expect(() => DemographicsPayloadSchema.parse(invalid)).toThrow();
	});

	it('does NOT expose PII fields', () => {
		const withPii = {
			shelter_code: 'SH001',
			age_groups: {
				'<1': 0,
				'1-5': 0,
				'6-11': 0,
				'12-19': 0,
				'20-59': 0,
				'60+': 0,
				unknown: 0
			},
			countries: {},
			national_id: '1234567890123'
		};
		const parsed = DemographicsPayloadSchema.parse(withPii);
		expect((parsed as Record<string, unknown>)['national_id']).toBeUndefined();
	});
});
