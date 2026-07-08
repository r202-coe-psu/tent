/**
 * Unit tests for dashboard-registration domain/schema.ts
 *
 * Tests:
 *   1. rowsToRegistrationsPayload — daily count mapping and total
 *   2. defaultDateRange — returns valid YYYY-MM-DD strings in correct order
 *   3. RegistrationsQuerySchema — validates date format and rejects bad input
 *   4. RegistrationsPayloadSchema — rejects invalid shape
 */
import { describe, it, expect } from 'vitest';
import {
	rowsToRegistrationsPayload,
	defaultDateRange,
	RegistrationsQuerySchema,
	RegistrationsPayloadSchema
} from './registration.schema';

describe('rowsToRegistrationsPayload', () => {
	it('aggregates daily counts and computes total', () => {
		const rows = [
			{ key: ['2026-06-01', 'checkin'], value: 5 },
			{ key: ['2026-06-02', 'checkin'], value: 8 },
			{ key: ['2026-06-03', 'checkout'], value: 3 }
		];
		const result = rowsToRegistrationsPayload('SH001', rows, '2026-06-01', '2026-06-03');
		expect(result.checkin['2026-06-01']).toBe(5);
		expect(result.checkin['2026-06-02']).toBe(8);
		expect(result.checkout['2026-06-03']).toBe(3);
		expect(result.total).toBe(13);
		expect(result.range.from).toBe('2026-06-01');
		expect(result.range.to).toBe('2026-06-03');
	});

	it('returns zero total for empty rows', () => {
		const result = rowsToRegistrationsPayload('SH001', [], '2026-06-01', '2026-06-30');
		expect(result.total).toBe(0);
		expect(result.checkin).toEqual({});
		expect(result.checkout).toEqual({});
	});
});

describe('defaultDateRange', () => {
	it('returns strings in YYYY-MM-DD format', () => {
		const { from, to } = defaultDateRange();
		expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('from is earlier than to', () => {
		const { from, to } = defaultDateRange();
		expect(new Date(from) < new Date(to)).toBe(true);
	});
});

describe('RegistrationsQuerySchema', () => {
	it('accepts valid from/to pair', () => {
		expect(() =>
			RegistrationsQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30' })
		).not.toThrow();
	});

	it('accepts empty object (both params optional)', () => {
		expect(() => RegistrationsQuerySchema.parse({})).not.toThrow();
	});

	it('rejects invalid date format', () => {
		expect(() => RegistrationsQuerySchema.parse({ from: '01-06-2026' })).toThrow();
		expect(() => RegistrationsQuerySchema.parse({ to: '2026/06/30' })).toThrow();
	});
});

describe('RegistrationsPayloadSchema', () => {
	it('accepts a valid payload', () => {
		const valid = {
			shelter_code: 'SH001',
			range: { from: '2026-06-01', to: '2026-06-30' },
			checkin: { '2026-06-01': 5, '2026-06-02': 8 },
			checkout: { '2026-06-03': 3 },
			total: 13
		};
		expect(() => RegistrationsPayloadSchema.parse(valid)).not.toThrow();
	});

	it('does NOT expose PII fields', () => {
		const withPii = {
			shelter_code: 'SH001',
			range: { from: '2026-06-01', to: '2026-06-30' },
			checkin: {},
			checkout: {},
			total: 0,
			first_name: 'John',
			national_id: '1234567890123'
		};
		const parsed = RegistrationsPayloadSchema.parse(withPii);
		expect((parsed as Record<string, unknown>)['first_name']).toBeUndefined();
		expect((parsed as Record<string, unknown>)['national_id']).toBeUndefined();
	});
});
