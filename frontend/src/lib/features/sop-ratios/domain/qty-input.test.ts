import { describe, it, expect } from 'vitest';
import { isPositiveQty } from './qty-input';

describe('isPositiveQty (#936)', () => {
	it.each([undefined, '', 'abc', '0', '-1', '0.00001', 0, 0.00004])('%s is not positive', (v) => {
		expect(isPositiveQty(v)).toBe(false);
	});

	it.each(['0.0001', '1', '2100.5', 1, 0.0001])('%s is positive', (v) => {
		expect(isPositiveQty(v)).toBe(true);
	});
});
