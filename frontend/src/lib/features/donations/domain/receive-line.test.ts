import { describe, expect, it } from 'vitest';
import { receivedQtyDifference } from './receive-line';

describe('receivedQtyDifference', () => {
	it('reports a shortfall in the same unit', () => {
		expect(
			receivedQtyDifference({ declaredQty: '10', declaredUnit: 'piece', qty: '7', unit: 'piece' })
		).toEqual({ more: false, amount: '3' });
	});

	it('reports a surplus in the same unit', () => {
		expect(
			receivedQtyDifference({ declaredQty: '2', declaredUnit: 'kg', qty: '2.5', unit: 'kg' })
		).toEqual({ more: true, amount: '0.5' });
	});

	it('is silent when counted equals declared', () => {
		expect(
			receivedQtyDifference({ declaredQty: '4', declaredUnit: 'box', qty: '4', unit: 'box' })
		).toBeNull();
	});

	it('does not compare across units (box declared, counted in bottles)', () => {
		expect(
			receivedQtyDifference({ declaredQty: '3', declaredUnit: 'box', qty: '36', unit: 'bottle' })
		).toBeNull();
	});

	it('does not compare when the declared unit resolves to no known unit', () => {
		expect(
			receivedQtyDifference({ declaredQty: '3', declaredUnit: null, qty: '5', unit: 'piece' })
		).toBeNull();
	});

	it('ignores an unparseable count instead of throwing', () => {
		expect(
			receivedQtyDifference({ declaredQty: '3', declaredUnit: 'piece', qty: 'abc', unit: 'piece' })
		).toBeNull();
	});
});
