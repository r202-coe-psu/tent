import { describe, expect, it } from 'vitest';
import {
	formatPhoneForDisplay,
	normalizeKioskPhone,
	phoneSuffixForLog,
	phoneVariants
} from './phone';

describe('normalizeKioskPhone', () => {
	it.each([
		['0812345678', '0812345678'],
		['081-234-5678', '0812345678'],
		['+66812345678', '0812345678'],
		['66812345678', '0812345678'],
		['021234567', '021234567']
	])('normalizes %s', (input, expected) => {
		expect(normalizeKioskPhone(input)).toBe(expected);
	});

	it.each(['12345678', '08123', '081234567890', '', '+660812345678'])('rejects %s', (input) => {
		expect(normalizeKioskPhone(input)).toBeNull();
	});
});

describe('phone variants and display helpers', () => {
	it('returns the canonical and international stored forms', () => {
		expect(phoneVariants('0812345678')).toEqual(['0812345678', '+66812345678']);
	});

	it('masks all but the final four digits in logs', () => {
		expect(phoneSuffixForLog('0812345678')).toBe('••••••5678');
	});

	it('formats complete mobile and landline numbers and leaves partial input intact', () => {
		expect(formatPhoneForDisplay('0812345678')).toBe('081-234-5678');
		expect(formatPhoneForDisplay('021234567')).toBe('02-123-4567');
		expect(formatPhoneForDisplay('08123')).toBe('08123');
	});
});
