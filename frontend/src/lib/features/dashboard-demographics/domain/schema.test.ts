/**
 * Unit tests for dashboard-demographics domain/schema.ts
 *
 * Tests:
 *   1. rowsToAgeGroups — correct bucket mapping and defaulting to 0
 *   2. rowsToNationalities — arbitrary key grouping
 *   3. DemographicsPayloadSchema — rejects missing / negative fields
 */
import { describe, it, expect } from 'vitest';
import {
	rowsToAgeGroups,
	rowsToCountries,
	DemographicsPayloadSchema
} from './schema';

describe('rowsToAgeGroups', () => {
	it('correctly maps all defined age buckets', () => {
		const rows = [
			{ key: '0-4', value: 2 },
			{ key: '5-11', value: 3 },
			{ key: '12-17', value: 1 },
			{ key: '18-59', value: 40 },
			{ key: '60+', value: 10 },
			{ key: 'unknown', value: 5 }
		];
		const result = rowsToAgeGroups(rows);
		expect(result['0-4']).toBe(2);
		expect(result['5-11']).toBe(3);
		expect(result['12-17']).toBe(1);
		expect(result['18-59']).toBe(40);
		expect(result['60+']).toBe(10);
		expect(result.unknown).toBe(5);
	});

	it('defaults missing buckets to 0', () => {
		const result = rowsToAgeGroups([{ key: '18-59', value: 20 }]);
		expect(result['0-4']).toBe(0);
		expect(result['60+']).toBe(0);
	});

	it('discards unknown bucket keys silently', () => {
		const result = rowsToAgeGroups([{ key: 'century', value: 1 }]);
		// 'century' is not in AGE_BUCKETS — all known buckets should be 0
		expect(result['18-59']).toBe(0);
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
			age_groups: { '0-4': 0, '5-11': 0, '12-17': 0, '18-59': 5, '60+': 0, unknown: 0 },
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
			age_groups: { '0-4': 0, '5-11': 0, '12-17': 0, '18-59': 0, '60+': 0, unknown: 0 },
			countries: {},
			national_id: '1234567890123'
		};
		const parsed = DemographicsPayloadSchema.parse(withPii);
		expect((parsed as Record<string, unknown>)['national_id']).toBeUndefined();
	});
});
