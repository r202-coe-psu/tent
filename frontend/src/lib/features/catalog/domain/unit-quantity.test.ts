import { describe, it, expect } from 'vitest';
import {
	WHOLE_QTY_MESSAGE,
	qtyInputStep,
	requiresWholeQty,
	resolveUnitDimension,
	wholeQtyError
} from './unit-quantity';

describe('resolveUnitDimension', () => {
	it('resolves built-in unit codes', () => {
		expect(resolveUnitDimension('piece')).toBe('count');
		expect(resolveUnitDimension('kg')).toBe('mass');
		expect(resolveUnitDimension('l')).toBe('volume');
	});

	it('resolves legacy Thai labels and aliases', () => {
		expect(resolveUnitDimension('ชิ้น')).toBe('count');
		expect(resolveUnitDimension('กรัม')).toBe('mass');
		expect(resolveUnitDimension('pcs')).toBe('count');
	});

	it('returns undefined for unknown, empty or missing units', () => {
		expect(resolveUnitDimension('wibble')).toBeUndefined();
		expect(resolveUnitDimension('')).toBeUndefined();
		expect(resolveUnitDimension(null)).toBeUndefined();
		expect(resolveUnitDimension(undefined)).toBeUndefined();
	});

	it('resolves a master-only unit', () => {
		expect(resolveUnitDimension('crate', [{ code: 'crate', dimension: 'count' }])).toBe('count');
	});

	it('lets the master list override the built-in dimension', () => {
		expect(resolveUnitDimension('gallon')).toBe('volume');
		expect(resolveUnitDimension('gallon', [{ code: 'gallon', dimension: 'count' }])).toBe('count');
	});

	it('falls back to built-ins for codes absent from the master list', () => {
		expect(resolveUnitDimension('kg', [{ code: 'crate', dimension: 'count' }])).toBe('mass');
	});
});

describe('wholeQtyError', () => {
	it('rejects a fraction for count units', () => {
		expect(wholeQtyError(1.5, 'count')).toBe(WHOLE_QTY_MESSAGE);
		expect(wholeQtyError('1.5', 'count')).toBe(WHOLE_QTY_MESSAGE);
	});

	it('accepts whole numbers for count units, including 2.0', () => {
		expect(wholeQtyError(2, 'count')).toBeUndefined();
		expect(wholeQtyError('2', 'count')).toBeUndefined();
		expect(wholeQtyError('2.0', 'count')).toBeUndefined();
	});

	it('accepts decimals for other dimensions', () => {
		expect(wholeQtyError(1.5, 'mass')).toBeUndefined();
		expect(wholeQtyError('0.25', 'volume')).toBeUndefined();
	});

	it('does not enforce an unknown dimension', () => {
		expect(wholeQtyError(1.5, undefined)).toBeUndefined();
	});

	it('leaves empty and unparseable input to other validators', () => {
		expect(wholeQtyError('', 'count')).toBeUndefined();
		expect(wholeQtyError(null, 'count')).toBeUndefined();
		expect(wholeQtyError(undefined, 'count')).toBeUndefined();
		expect(wholeQtyError('abc', 'count')).toBeUndefined();
	});
});

describe('input rules', () => {
	it('requires whole numbers only for count', () => {
		expect(requiresWholeQty('count')).toBe(true);
		expect(requiresWholeQty('mass')).toBe(false);
		expect(requiresWholeQty(undefined)).toBe(false);
	});

	it('steps by 1 for count and freely otherwise', () => {
		expect(qtyInputStep('count')).toBe('1');
		expect(qtyInputStep('volume')).toBe('any');
		expect(qtyInputStep(undefined)).toBe('any');
	});
});
