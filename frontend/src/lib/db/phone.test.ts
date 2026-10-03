import { describe, expect, it } from 'vitest';
import { normalizeThaiPhone, phoneSchema, sanitizePhoneTyping } from './model';

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
