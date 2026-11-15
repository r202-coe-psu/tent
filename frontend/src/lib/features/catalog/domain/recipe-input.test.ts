import { describe, expect, it } from 'vitest';
import { sanitizeInteger, sanitizeQuantity } from './recipe-input';

describe('sanitizeQuantity', () => {
	it.each([
		['12.5', '12.5'],
		['0.5', '0.5'],
		['abc1b2', '12'],
		['1.2.3', '1.23'],
		['007', '7'],
		['00.5', '0.5'],
		['0', '0'],
		['00', '0'],
		['', '']
	])('%j -> %j', (raw, expected) => {
		expect(sanitizeQuantity(raw)).toBe(expected);
	});
});

describe('sanitizeInteger', () => {
	it.each([
		['100', '100'],
		['0100', '100'],
		['1.5', '15'],
		['a2b', '2'],
		['0', '0'],
		['', '']
	])('%j -> %j', (raw, expected) => {
		expect(sanitizeInteger(raw)).toBe(expected);
	});
});
