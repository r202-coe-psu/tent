/**
 * Unit tests for dashboard-registration domain/schema.ts
 *
 * Tests:
 *   1. rowsToRegistrationsPayload — daily count mapping and total
 *   2. defaultRangeFrom — starts at the shelter's creation day (Asia/Bangkok)
 *   3. RegistrationsQuerySchema — validates date format and rejects bad input
 *   4. RegistrationsPayloadSchema — rejects invalid shape
 */
import { describe, it, expect } from 'vitest';
import {
	rowsToRegistrationsPayload,
	defaultRangeFrom,
	registrationRangeParams,
	shiftIsoDate,
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
		expect(result.preregister).toEqual({});
	});

	it('fills preregister per day without adding it to the check-in total', () => {
		const rows = [
			{ key: ['2026-06-01', 'preregister'], value: 4 },
			{ key: ['2026-06-01', 'checkin'], value: 2 },
			{ key: ['2026-06-02', 'preregister'], value: 6 }
		];
		const result = rowsToRegistrationsPayload('SH001', rows, '2026-06-01', '2026-06-02');
		expect(result.preregister).toEqual({ '2026-06-01': 4, '2026-06-02': 6 });
		expect(result.checkin).toEqual({ '2026-06-01': 2 });
		expect(result.total).toBe(2);
	});
});

describe('defaultRangeFrom', () => {
	it('starts on the day the shelter was created', () => {
		expect(defaultRangeFrom('2026-03-10T05:00:00.000Z', '2026-03-12', '2026-10-16')).toBe(
			'2026-03-10'
		);
	});

	it('uses the Bangkok calendar day of created_at, not the UTC one', () => {
		// 20:00 UTC on the 9th is 03:00 on the 10th in Bangkok.
		expect(defaultRangeFrom('2026-03-09T20:00:00.000Z', undefined, '2026-10-16')).toBe(
			'2026-03-10'
		);
	});

	it('moves back to a movement dated before the shelter was created', () => {
		expect(defaultRangeFrom('2026-03-10T05:00:00.000Z', '2026-03-01', '2026-10-16')).toBe(
			'2026-03-01'
		);
	});

	it('falls back to the earliest movement when created_at is missing or invalid', () => {
		expect(defaultRangeFrom(undefined, '2026-04-02', '2026-10-16')).toBe('2026-04-02');
		expect(defaultRangeFrom('not-a-date', '2026-04-02', '2026-10-16')).toBe('2026-04-02');
	});

	it('never starts after `to`', () => {
		expect(defaultRangeFrom('2026-10-20T05:00:00.000Z', undefined, '2026-10-16')).toBe(
			'2026-10-16'
		);
		expect(defaultRangeFrom(null, undefined, '2026-10-16')).toBe('2026-10-16');
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
	it('rejects a payload without the preregister series', () => {
		const withoutPreregister = {
			shelter_code: 'SH001',
			range: { from: '2026-06-01', to: '2026-06-30' },
			checkin: {},
			checkout: {},
			total: 0
		};
		expect(RegistrationsPayloadSchema.safeParse(withoutPreregister).success).toBe(false);
	});

	it('accepts a valid payload', () => {
		const valid = {
			shelter_code: 'SH001',
			range: { from: '2026-06-01', to: '2026-06-30' },
			checkin: { '2026-06-01': 5, '2026-06-02': 8 },
			checkout: { '2026-06-03': 3 },
			preregister: { '2026-06-01': 2 },
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
			preregister: {},
			total: 0,
			first_name: 'John',
			national_id: '1234567890123'
		};
		const parsed = RegistrationsPayloadSchema.parse(withPii);
		expect((parsed as Record<string, unknown>)['first_name']).toBeUndefined();
		expect((parsed as Record<string, unknown>)['national_id']).toBeUndefined();
	});
});

describe('RegistrationsQuerySchema from ≤ to', () => {
	it('rejects `from` after `to`', () => {
		expect(
			RegistrationsQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success
		).toBe(false);
	});

	it('accepts a single-day range and a lone bound', () => {
		expect(
			RegistrationsQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-10' }).success
		).toBe(true);
		expect(RegistrationsQuerySchema.safeParse({ from: '2026-10-10' }).success).toBe(true);
	});
});

describe('shiftIsoDate', () => {
	it('crosses month and year boundaries', () => {
		expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
		expect(shiftIsoDate('2026-01-01', -1)).toBe('2025-12-31');
	});
});

describe('registrationRangeParams', () => {
	const today = '2026-10-16';

	it('covers N days including today for the N-day presets', () => {
		expect(registrationRangeParams('7d', today)).toEqual({ from: '2026-10-10', to: today });
		expect(registrationRangeParams('14d', today)).toEqual({ from: '2026-10-03', to: today });
		expect(registrationRangeParams('30d', today)).toEqual({ from: '2026-09-17', to: today });
	});

	it('sends no bounds for since_open so the server picks the creation day', () => {
		expect(registrationRangeParams('since_open', today)).toEqual({});
	});

	it('passes a custom range through, and sends nothing until one is picked', () => {
		const custom = { from: '2026-09-01', to: '2026-09-30' };
		expect(registrationRangeParams('custom', today, custom)).toEqual(custom);
		expect(registrationRangeParams('custom', today)).toEqual({});
	});
});
