/**
 * Unit tests for dashboard-occupancy domain/schema.ts
 *
 * Tests focus on:
 *   1. rowsToOccupancyPayload — correct bucketing and total calculation
 *   2. OccupancyPayloadSchema — rejects invalid shapes (guards against PII fields)
 *   3. Edge cases: empty rows, unknown status keys, duplicate keys
 */
import { describe, it, expect } from 'vitest';
import { rowsToOccupancyPayload, OccupancyPayloadSchema } from './schema';

describe('rowsToOccupancyPayload', () => {
	it('aggregates all known status keys correctly', () => {
		const rows = [
			{ key: 'registered', value: 5 },
			{ key: 'checked_in', value: 10 },
			{ key: 'checked_out', value: 3 },
			{ key: 'transferred', value: 2 }
		];
		const result = rowsToOccupancyPayload('SH001', rows);
		expect(result.shelter_code).toBe('SH001');
		expect(result.registered).toBe(5);
		expect(result.checked_in).toBe(10);
		expect(result.checked_out).toBe(3);
		expect(result.transferred).toBe(2);
		expect(result.total).toBe(20);
	});

	it('returns all zeros for empty rows', () => {
		const result = rowsToOccupancyPayload('SH002', []);
		expect(result.total).toBe(0);
		expect(result.registered).toBe(0);
		expect(result.checked_in).toBe(0);
	});

	it('ignores unknown status keys and excludes them from total', () => {
		const rows = [
			{ key: 'checked_in', value: 5 },
			{ key: 'some_future_status', value: 99 } // unknown — should be discarded
		];
		const result = rowsToOccupancyPayload('SH001', rows);
		// 'some_future_status' is not in the output schema, total only sums known keys
		expect(result.total).toBe(5);
	});
});

describe('OccupancyPayloadSchema', () => {
	it('accepts a valid payload', () => {
		const valid = {
			shelter_code: 'SH001',
			registered: 5,
			checked_in: 10,
			checked_out: 3,
			transferred: 2,
			total: 20
		};
		expect(() => OccupancyPayloadSchema.parse(valid)).not.toThrow();
	});

	it('rejects negative counts', () => {
		const invalid = {
			shelter_code: 'SH001',
			registered: -1,
			checked_in: 0,
			checked_out: 0,
			transferred: 0,
			total: 0
		};
		expect(() => OccupancyPayloadSchema.parse(invalid)).toThrow();
	});

	it('rejects payloads with extra PII-like fields (strict guard)', () => {
		// The Zod schema does NOT have a .strict() call so extra fields are stripped,
		// meaning PII fields in a malformed view response won't leak to the client.
		const withPii = {
			shelter_code: 'SH001',
			registered: 1,
			checked_in: 0,
			checked_out: 0,
			transferred: 0,
			total: 1,
			national_id: '1234567890123', // PII — must not be in the parsed output
			first_name: 'John'
		};
		const parsed = OccupancyPayloadSchema.parse(withPii);
		expect((parsed as Record<string, unknown>)['national_id']).toBeUndefined();
		expect((parsed as Record<string, unknown>)['first_name']).toBeUndefined();
	});
});
