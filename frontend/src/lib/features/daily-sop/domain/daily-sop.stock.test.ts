import { describe, expect, it } from 'vitest';
import { formatStockQuantity, isNonPositiveStockQuantity } from './daily-sop.stock';

describe('Daily SOP stock quantity formatting', () => {
	it('adds grouping separators without rounding decimal strings', () => {
		expect(formatStockQuantity('1234567.8900')).toBe('1,234,567.8900');
		expect(formatStockQuantity('-1234.5')).toBe('-1,234.5');
	});

	it('recognizes zero and negative quantities without numeric coercion', () => {
		expect(isNonPositiveStockQuantity('0')).toBe(true);
		expect(isNonPositiveStockQuantity('0.000')).toBe(true);
		expect(isNonPositiveStockQuantity('-0.1')).toBe(true);
		expect(isNonPositiveStockQuantity('0.01')).toBe(false);
		expect(isNonPositiveStockQuantity('invalid')).toBe(false);
	});
});
