import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
	it.each([
		['+66812345678', '0812345678'],
		['66812345678', '0812345678'],
		['081-234 5678', '0812345678'],
		['(081) 234-5678', '0812345678'],
		['0812345678', '0812345678']
	])('normalizes %s to %s', (input, expected) => {
		expect(normalizePhone(input)).toBe(expected);
	});

	it('leaves a short 66-prefixed number alone (under 11 digits)', () => {
		expect(normalizePhone('661234567')).toBe('661234567');
	});
});
