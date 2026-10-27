import { describe, expect, it } from 'vitest';
import { isCount, isPositiveQty, keyRejection, textRejection } from './count-input';

describe('isCount', () => {
	it('accepts finite numbers at or above the minimum', () => {
		expect(isCount(0, 0)).toBe(true);
		expect(isCount(7, 1)).toBe(true);
	});

	it('rejects negatives, values below the minimum, and non-numbers', () => {
		expect(isCount(-1, 0)).toBe(false);
		expect(isCount(0, 1)).toBe(false);
		expect(isCount(null, 0)).toBe(false);
		expect(isCount(undefined, 0)).toBe(false);
		expect(isCount(Number.NaN, 0)).toBe(false);
		expect(isCount(Number.POSITIVE_INFINITY, 0)).toBe(false);
	});
});

describe('isPositiveQty', () => {
	it('accepts positive decimals as numbers or strings', () => {
		expect(isPositiveQty('0.25')).toBe(true);
		expect(isPositiveQty(3)).toBe(true);
	});

	it('rejects zero, negatives, empty and non-numeric input', () => {
		expect(isPositiveQty('0')).toBe(false);
		expect(isPositiveQty('-0.5')).toBe(false);
		expect(isPositiveQty(-2)).toBe(false);
		expect(isPositiveQty('')).toBe(false);
		expect(isPositiveQty(null)).toBe(false);
		expect(isPositiveQty('abc')).toBe(false);
	});
});

describe('keyRejection', () => {
	it('refuses the minus, plus and exponent keys', () => {
		expect(keyRejection({ key: '-' })).toBe('negative');
		expect(keyRejection({ key: '+' })).toBe('non-numeric');
		expect(keyRejection({ key: 'e' })).toBe('non-numeric');
		expect(keyRejection({ key: 'E' })).toBe('non-numeric');
	});

	it('lets digits, the decimal point, navigation keys and shortcuts through', () => {
		for (const key of ['0', '9', '.', 'Backspace', 'ArrowLeft', 'Tab']) {
			expect(keyRejection({ key })).toBeNull();
		}
		expect(keyRejection({ key: 'e', ctrlKey: true })).toBeNull();
		expect(keyRejection({ key: '-', metaKey: true })).toBeNull();
	});
});

describe('textRejection', () => {
	it('accepts unsigned decimals and empty text', () => {
		for (const text of ['0', '5', ' 12 ', '2.5', '.5', '3.', '']) {
			expect(textRejection(text)).toBeNull();
		}
	});

	it('flags a leading minus as negative', () => {
		for (const text of ['-5', '-0', '-0.5', ' -3', '-']) {
			expect(textRejection(text)).toBe('negative');
		}
	});

	it('flags anything else that is not an unsigned decimal as non-numeric', () => {
		for (const text of ['+5', '1e3', 'abc', '1,000', '1.2.3', '5-']) {
			expect(textRejection(text)).toBe('non-numeric');
		}
	});
});
