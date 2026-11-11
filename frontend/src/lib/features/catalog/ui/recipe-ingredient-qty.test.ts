import { describe, expect, it } from 'vitest';
import { WHOLE_QTY_MESSAGE, resolveUnitDimension } from '../domain/unit-quantity';
import { recipeIngredientQtyIssues } from './recipe-ingredient-qty';

const resolve = (unit: string) => resolveUnitDimension(unit);

describe('recipeIngredientQtyIssues', () => {
	it('flags a fractional quantity in a count unit', () => {
		expect(recipeIngredientQtyIssues([{ quantity: '1.5', uom: 'bottle' }], resolve)).toEqual([
			{ index: 0, message: WHOLE_QTY_MESSAGE }
		]);
	});

	it('accepts whole counts and decimals in mass or volume units', () => {
		expect(
			recipeIngredientQtyIssues(
				[
					{ quantity: '2', uom: 'bottle' },
					{ quantity: '1.5', uom: 'kg' },
					{ quantity: '0.25', uom: 'l' }
				],
				resolve
			)
		).toEqual([]);
	});

	it('does not enforce on an unknown unit', () => {
		expect(recipeIngredientQtyIssues([{ quantity: '1.5', uom: 'ถุงเก่า??' }], resolve)).toEqual([]);
	});

	it('reports the index of each offending row', () => {
		const issues = recipeIngredientQtyIssues(
			[
				{ quantity: '1', uom: 'bottle' },
				{ quantity: '0.5', uom: 'box' },
				{ quantity: '3.2', uom: 'bag' }
			],
			resolve
		);
		expect(issues.map((i) => i.index)).toEqual([1, 2]);
	});
});
