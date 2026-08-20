import { describe, it, expect } from 'vitest';
import { createEvacuee } from '$lib/features/people/server';
import {
	bookingCodeFrom,
	evacueeIdFromBookingCode,
	publicBookingErrorMessage,
	publicBookingInputSchema,
	publicBookingLookupSchema,
	toEvacueeInput
} from './booking';

const VALID = {
	shelter_code: 'SH001',
	first_name: '  สมชาย ',
	last_name: 'ใจดี',
	gender: 'male' as const,
	phone: '0812345678'
};

describe('publicBookingInputSchema', () => {
	it('trims names and accepts the T-48 minimum', () => {
		const parsed = publicBookingInputSchema.parse(VALID);
		expect(parsed.first_name).toBe('สมชาย');
		expect(parsed.shelter_code).toBe('SH001');
	});

	it('requires a 10-digit phone — D-BOOK-TOKEN=A uses it as the second factor', () => {
		expect(publicBookingInputSchema.safeParse({ ...VALID, phone: null }).success).toBe(false);
		expect(publicBookingInputSchema.safeParse({ ...VALID, phone: '081234567' }).success).toBe(
			false
		);
		expect(publicBookingInputSchema.safeParse({ ...VALID, phone: '08123456ab' }).success).toBe(
			false
		);
	});

	it('rejects a malformed shelter code', () => {
		expect(publicBookingInputSchema.safeParse({ ...VALID, shelter_code: 'sh1' }).success).toBe(
			false
		);
	});

	it('drops fields the public form must not be able to set', () => {
		const parsed = publicBookingInputSchema.parse({
			...VALID,
			_id: 'evacuee:ATTACKER',
			_rev: '9-x',
			registered_via: 'app',
			current_stay: { status: 'active' },
			person_id: { cardType: 'national_id', number: '1234567890123' }
		});
		expect(parsed).not.toHaveProperty('_id');
		expect(parsed).not.toHaveProperty('_rev');
		expect(parsed).not.toHaveProperty('registered_via');
		expect(parsed).not.toHaveProperty('current_stay');
		expect(parsed).not.toHaveProperty('person_id');
	});
});

describe('toEvacueeInput → createEvacuee', () => {
	it('produces a pre_registered web booking with staff defaults', () => {
		const input = publicBookingInputSchema.parse(VALID);
		const evacuee = createEvacuee(toEvacueeInput(input), {
			shelterCode: input.shelter_code,
			createdBy: 'public'
		});

		expect(evacuee.type).toBe('evacuee');
		expect(evacuee.schema_v).toBe(7);
		expect(evacuee.registered_via).toBe('web');
		expect(evacuee.current_stay.status).toBe('pre_registered');
		expect(evacuee.household_id).toBeNull();
		expect(evacuee.created_by).toBe('public');
		// Untouched staff defaults keep web and counter registrations the same shape.
		expect(evacuee.country).toBe('THAILAND');
		expect(evacuee.special_needs).toEqual([]);
		expect(evacuee.privacy).toEqual({ search_excluded: false });
	});
});

describe('booking code', () => {
	const ulid = '01JABCDEFGHJKMNPQRSTVWXYZ0';

	it('strips and restores the doc-id prefix', () => {
		expect(bookingCodeFrom(`evacuee:${ulid}`)).toBe(ulid);
		expect(evacueeIdFromBookingCode(ulid)).toBe(`evacuee:${ulid}`);
	});

	it('round-trips regardless of how the citizen types it', () => {
		for (const typed of [ulid, ulid.toLowerCase(), `evacuee:${ulid}`, `  ${ulid}  `]) {
			expect(evacueeIdFromBookingCode(typed)).toBe(`evacuee:${ulid}`);
		}
	});

	it('leaves a bare ulid alone', () => {
		expect(bookingCodeFrom(ulid)).toBe(ulid);
	});
});

describe('publicBookingLookupSchema', () => {
	it('needs both factors', () => {
		expect(publicBookingLookupSchema.safeParse({ code: 'X', phone: '0812345678' }).success).toBe(
			true
		);
		expect(publicBookingLookupSchema.safeParse({ code: '', phone: '0812345678' }).success).toBe(
			false
		);
		expect(publicBookingLookupSchema.safeParse({ code: 'X' }).success).toBe(false);
	});
});

describe('publicBookingErrorMessage', () => {
	it('maps known codes to Thai copy', () => {
		expect(publicBookingErrorMessage('SHELTER_CLOSED')).toContain('ปิดรับ');
		expect(publicBookingErrorMessage('RATE_LIMITED')).toContain('ถี่เกินไป');
	});

	it('falls back for anything unrecognised', () => {
		expect(publicBookingErrorMessage('WAT')).toBe('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
		expect(publicBookingErrorMessage(undefined)).toBe('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
	});
});
