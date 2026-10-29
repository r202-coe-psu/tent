import { describe, expect, it } from 'vitest';
import { recipeInputSchema } from './catalog';
import { customRecipeInput, findRecipeByLabel } from './custom-recipe';

const rice = { item_master_id: 'item_master:rice', quantity: '2', uom: 'kg' };

describe('customRecipeInput', () => {
	it('scales quantities from the produced portions to the standard portions', () => {
		const input = customRecipeInput({
			label: '  Fried rice ',
			standardPortions: '10',
			producedPortions: '50',
			ingredients: [rice]
		});
		expect(input.label).toBe('Fried rice');
		expect(input.standard_portions).toBe('10');
		expect(input.standard_duration_hours).toBe('1');
		expect(input.ingredients).toEqual([{ ...rice, quantity: '0.4' }]);
	});

	it('keeps quantities unchanged when standard equals produced portions', () => {
		const input = customRecipeInput({
			label: 'Soup',
			standardPortions: '30',
			producedPortions: '30',
			ingredients: [rice]
		});
		expect(input.ingredients[0].quantity).toBe('2');
	});

	it('uses decimal arithmetic without floating-point drift', () => {
		const input = customRecipeInput({
			label: 'Soup',
			standardPortions: '3',
			producedPortions: '10',
			ingredients: [{ ...rice, quantity: '0.1' }]
		});
		expect(input.ingredients[0].quantity).toBe('0.03');
	});

	it('produces input the recipe schema accepts', () => {
		const input = customRecipeInput({
			label: 'Soup',
			standardPortions: '10',
			producedPortions: '50',
			ingredients: [rice]
		});
		expect(recipeInputSchema.safeParse(input).success).toBe(true);
	});

	it.each([
		['0', '10'],
		['-1', '10'],
		['10', '0'],
		['10', '-5']
	])('rejects non-positive portions (%s, %s)', (standardPortions, producedPortions) => {
		expect(() =>
			customRecipeInput({ label: 'x', standardPortions, producedPortions, ingredients: [rice] })
		).toThrow();
	});
});

describe('findRecipeByLabel', () => {
	const recipes = [
		{ label: 'Fried Rice', _id: 'a' },
		{ label: 'Soup', _id: 'b' }
	];

	it('matches ignoring case and surrounding whitespace', () => {
		expect(findRecipeByLabel(recipes, '  fried rice ')?._id).toBe('a');
	});

	it('returns undefined when absent, blank, or the list is missing', () => {
		expect(findRecipeByLabel(recipes, 'Curry')).toBeUndefined();
		expect(findRecipeByLabel(recipes, '   ')).toBeUndefined();
		expect(findRecipeByLabel(undefined, 'Soup')).toBeUndefined();
	});
});
