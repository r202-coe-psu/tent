import { describe, expect, it } from 'vitest';
import {
	persistedQuantityFromPerPotion,
	quantityPerPotionFromPersisted,
	totalQuantityForPotions
} from './recipe-quantity';

describe('recipe quantity conversion', () => {
	it('hydrates a persisted standard-recipe quantity as a per-potion quantity', () => {
		expect(quantityPerPotionFromPersisted('10000', '100')).toBe('100');
	});

	it('persists a per-potion quantity as the standard recipe total', () => {
		expect(persistedQuantityFromPerPotion('100', '100')).toBe('10000');
	});

	it('changes only the total when the standard potion yield changes', () => {
		expect(totalQuantityForPotions('100', '50')).toBe('5000');
	});

	it('uses decimal arithmetic without floating-point drift', () => {
		expect(totalQuantityForPotions('0.25', '100')).toBe('25');
	});

	it.each([
		['0', '1'],
		['-1', '1'],
		['1', '0'],
		['1', '-1']
	])('rejects non-positive quantity values (%s, %s)', (quantity, portions) => {
		expect(() => totalQuantityForPotions(quantity, portions)).toThrow(/must be greater than 0/);
	});
});
