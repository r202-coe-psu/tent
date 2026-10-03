import { describe, expect, it } from 'vitest';
import { isValidThaiNationalId } from './thai-id';

describe('isValidThaiNationalId', () => {
	it('accepts a valid id with or without separators', () => {
		expect(isValidThaiNationalId('1101700207030')).toBe(true);
		expect(isValidThaiNationalId('1-1017-00207-03-0')).toBe(true);
	});

	it('rejects a wrong check digit, wrong length or empty input', () => {
		expect(isValidThaiNationalId('1101700207031')).toBe(false);
		expect(isValidThaiNationalId('110170020703')).toBe(false);
		expect(isValidThaiNationalId('')).toBe(false);
	});
});
