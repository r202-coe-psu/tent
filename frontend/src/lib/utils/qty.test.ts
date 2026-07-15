import { describe, it, expect } from 'vitest';
import {
	addQty,
	parseQty,
	persistQty,
	qtyAbs,
	qtyGte,
	qtyGt,
	qtyNeg,
	qtyStrCoercePositiveSchema,
	qtyStrPositiveSchema,
	qtyStrSignedNonZeroSchema,
	roundQty,
	roundQtyNumber,
	subQty
} from './qty';

describe('persistQty / parseQty', () => {
	it('round-trips classic 0.1 + 0.2 from strings', () => {
		expect(persistQty(parseQty('0.1').plus('0.2'))).toBe('0.3');
	});

	it('keeps four fractional digits max', () => {
		expect(persistQty('1.23454')).toBe('1.2345');
		expect(persistQty('1.23456')).toBe('1.2346');
	});

	it('emits compact strings without forced padding', () => {
		expect(persistQty('15')).toBe('15');
		expect(persistQty('7.5')).toBe('7.5');
	});
});

describe('roundQty', () => {
	it('returns persist string', () => {
		expect(roundQty('0.1')).toBe('0.1');
	});
});

describe('roundQtyNumber', () => {
	it('clears classic float noise for SOP boundaries', () => {
		expect(0.1 + 0.2).not.toBe(0.3);
		expect(roundQtyNumber(0.1 + 0.2)).toBe(0.3);
	});
});

describe('addQty / subQty', () => {
	it('accumulates without float residue', () => {
		expect(addQty('0.1', '0.2')).toBe('0.3');
		expect(subQty('0.3', '0.1')).toBe('0.2');
	});
});

describe('qty comparisons', () => {
	it('treats string near-equals correctly', () => {
		expect(qtyGte(addQty('0.1', '0.2'), '0.3')).toBe(true);
		expect(qtyGt(addQty('0.1', '0.2'), '0.3')).toBe(false);
	});
});

describe('qtyAbs / qtyNeg', () => {
	it('handles signed ledger helpers', () => {
		expect(qtyAbs('-3.5')).toBe('3.5');
		expect(qtyNeg('2')).toBe('-2');
	});
});

describe('Zod qty schemas', () => {
	it('accepts positive qty strings', () => {
		expect(qtyStrPositiveSchema.parse('7.5')).toBe('7.5');
		expect(() => qtyStrPositiveSchema.parse('0')).toThrow();
	});

	it('rejects zero for signed nonzero', () => {
		expect(qtyStrSignedNonZeroSchema.parse('-1')).toBe('-1');
		expect(() => qtyStrSignedNonZeroSchema.parse('0')).toThrow();
	});

	it('coerces number at boundary to string', () => {
		expect(qtyStrCoercePositiveSchema.parse(7.5)).toBe('7.5');
	});
});
