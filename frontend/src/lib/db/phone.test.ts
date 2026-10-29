import { describe, expect, it } from 'vitest';
import {
	THAI_MOBILE_PHONE_MESSAGE,
	normalizeThaiPhone,
	phoneSchema,
	sanitizePhoneTyping,
	thaiMobilePhoneSchema
} from './model';

describe('normalizeThaiPhone (CR-148)', () => {
	it('maps +66 / 66 country-code forms to a leading 0', () => {
		expect(normalizeThaiPhone('+66812345678')).toBe('0812345678');
		expect(normalizeThaiPhone('+66 81-234-5678')).toBe('0812345678');
		expect(normalizeThaiPhone('66812345678')).toBe('0812345678');
		expect(normalizeThaiPhone('+6621234567')).toBe('021234567');
	});

	it('only strips separators from local numbers', () => {
		expect(normalizeThaiPhone('081-234-5678')).toBe('0812345678');
		expect(normalizeThaiPhone('(02) 123 4567')).toBe('021234567');
	});
});

describe('phoneSchema', () => {
	it('stores +66 input as local digits and keeps empty as null', () => {
		expect(phoneSchema.parse('+66 81 234 5678')).toBe('0812345678');
		expect(phoneSchema.parse('')).toBeNull();
		expect(phoneSchema.parse(null)).toBeNull();
	});

	it('rejects non-numeric input', () => {
		expect(phoneSchema.safeParse('abc').success).toBe(false);
	});
});

describe('sanitizePhoneTyping (CR-148 FR-10)', () => {
	it('keeps a partial +66 number while typing and collapses it when complete', () => {
		expect(sanitizePhoneTyping('+66 8')).toBe('+668');
		expect(sanitizePhoneTyping('+66 81 234 5678')).toBe('0812345678');
		expect(sanitizePhoneTyping('66812345678')).toBe('0812345678');
	});

	it('caps local numbers at 10 digits and drops other characters', () => {
		expect(sanitizePhoneTyping('081-234-56789')).toBe('0812345678');
		expect(sanitizePhoneTyping('08a1')).toBe('081');
	});
});

describe('thaiMobilePhoneSchema', () => {
	it('accepts the canonical number', () => {
		expect(thaiMobilePhoneSchema.parse('0891234567')).toBe('0891234567');
	});

	it('normalizes formatted and country-code forms', () => {
		for (const v of [
			'089-123-4567',
			'089 123 4567',
			'(089)1234567',
			'+66891234567',
			'66891234567'
		]) {
			expect(thaiMobilePhoneSchema.parse(v)).toBe('0891234567');
		}
	});

	it('maps blank / missing to null', () => {
		for (const v of ['', '   ', undefined, null]) {
			expect(thaiMobilePhoneSchema.parse(v)).toBeNull();
		}
	});

	it('rejects 9 and 11 digits with the shared message', () => {
		for (const v of ['089123456', '08912345678']) {
			const r = thaiMobilePhoneSchema.safeParse(v);
			expect(r.success).toBe(false);
			expect(r.error?.issues[0].message).toBe(THAI_MOBILE_PHONE_MESSAGE);
		}
	});

	it('rejects bad prefix, letters and Thai digits (no sanitizing)', () => {
		for (const v of ['1891234567', '08912abc67', '๐๘๙๑๒๓๔๕๖๗']) {
			expect(thaiMobilePhoneSchema.safeParse(v).success).toBe(false);
		}
	});

	it('never merges different numbers or accepts a 00 prefix', () => {
		expect(thaiMobilePhoneSchema.parse('0891234567')).not.toBe(
			thaiMobilePhoneSchema.parse('0891234568')
		);
		expect(thaiMobilePhoneSchema.safeParse('0066891234567').success).toBe(false);
		expect(thaiMobilePhoneSchema.safeParse('6689123456').success).toBe(false);
	});
});
