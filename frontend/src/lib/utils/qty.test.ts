import { describe, it, expect } from 'vitest';
import {
	toQtyStrLossless,
	addQty,
	parseQtyInput,
	formatQty,
	parseQty,
	parseQtyInput,
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

describe('formatQty', () => {
	it('groups thousands so large amounts read at a glance', () => {
		expect(formatQty('1234567')).toBe('1,234,567');
		expect(formatQty('12500.5')).toBe('12,500.5');
	});

	it('keeps small and fractional amounts as they are', () => {
		expect(formatQty('0')).toBe('0');
		expect(formatQty('999')).toBe('999');
		expect(formatQty('0.1234')).toBe('0.1234');
	});

	it('rounds past the quantity scale instead of showing float noise', () => {
		expect(formatQty('1000.00005')).toBe('1,000.0001');
	});
});

describe('parseQtyInput', () => {
	it('returns the canonical qty string for what a number input can hold', () => {
		const cases: [string, string][] = [
			['0', '0'],
			['12', '12'],
			['-0.1', '-0.1'],
			['0.30', '0.3'],
			['.5', '0.5'],
			['5.', '5'],
			[' 1.2345 ', '1.2345']
		];
		for (const [raw, out] of cases) expect(parseQtyInput(raw)).toBe(out);
	});

	it('returns null for blanks, exponents, hex, and more than 4 decimals', () => {
		for (const raw of ['', ' ', '.', '-', '1e3', '0x10', '1.23456', 'Infinity', '+1', '1 2']) {
			expect(parseQtyInput(raw)).toBeNull();
		}
	});
});

describe('parseQtyInput size limit', () => {
	it('keeps 15 integer digits exact', () => {
		expect(parseQtyInput('999999999999999.9999')).toBe('999999999999999.9999');
	});

	it('returns null past 15 integer digits instead of exponent notation', () => {
		for (const raw of ['1000000000000000', '1000000000000000000000', '-99999999999999999999.5']) {
			expect(parseQtyInput(raw)).toBeNull();
		}
	});
});

describe('toQtyStrLossless (#936)', () => {
	it('converts a number to an exact string without rounding', () => {
		expect(toQtyStrLossless(6.33333)).toBe('6.33333');
	});
	it('avoids exponent notation', () => {
		expect(toQtyStrLossless(1e-7)).toBe('0.0000001');
	});
	it('passes strings and non-finite numbers through', () => {
		expect(toQtyStrLossless('2.5')).toBe('2.5');
		expect(toQtyStrLossless(NaN)).toBeNaN();
		expect(toQtyStrLossless(undefined)).toBeUndefined();
	});
});

describe('parseQtyInput (#939)', () => {
	it.each([
		['0.30000', '0.3'],
		['1', '1'],
		['12.5', '12.5'],
		[' 3 ', '3'],
		['0.1200', '0.12'],
		// Never exponent notation — `Decimal#toString()` would turn these into `1e+21` (#939 review W1)
		['1000000000000000000000', '1000000000000000000000'],
		['123456789012345678901234.5', '123456789012345678901234.5']
	])('accepts %s as %s', (raw, expected) => {
		expect(parseQtyInput(raw)).toBe(expected);
	});

	it.each(['', '  ', '1e3', '1e21', '0.12345', '-1', '1,5', 'abc', '1.', '.5', 'NaN', 'Infinity'])(
		'rejects %j',
		(raw) => {
			expect(parseQtyInput(raw)).toBeNull();
		}
	);
});
