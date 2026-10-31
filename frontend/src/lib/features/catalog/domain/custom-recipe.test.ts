import { describe, expect, it } from 'vitest';
import { recipeInputSchema } from './catalog';
import {
	CUSTOM_RECIPE_DURATION_HOURS,
	customRecipeInput,
	findRecipeByLabel,
	type CustomRecipeIngredient
} from './custom-recipe';

const rice: CustomRecipeIngredient = {
	item_master_id: 'item_master:rice',
	name: 'ข้าวสาร',
	quantity: '2',
	uom: 'kg'
};

function build(overrides: Partial<Parameters<typeof customRecipeInput>[0]> = {}) {
	return customRecipeInput({
		label: 'Soup',
		portions: 50,
		ingredients: [rice],
		...overrides
	});
}

describe('customRecipeInput', () => {
	it('stores the ingredient list as cooked, at the batch portions', () => {
		const result = build({ label: '  Fried rice ' });
		expect(result).toEqual({
			ok: true,
			input: {
				label: 'Fried rice',
				standard_portions: '50',
				standard_duration_hours: CUSTOM_RECIPE_DURATION_HOURS,
				ingredients: [{ item_master_id: rice.item_master_id, quantity: '2', uom: 'kg' }]
			}
		});
	});

	it('produces input the recipe schema accepts', () => {
		const result = build();
		expect(result.ok && recipeInputSchema.safeParse(result.input).success).toBe(true);
	});

	it('stores legacy Thai unit labels as canonical unit codes', () => {
		const result = build({ ingredients: [{ ...rice, uom: 'กก.' }] });
		expect(result.ok && result.input.ingredients[0].uom).toBe('kg');
	});

	it('explains an unknown unit in Thai', () => {
		expect(build({ ingredients: [{ ...rice, uom: '???' }] })).toEqual({
			ok: false,
			reason: 'ไม่รู้จักหน่วย "???" ของ ข้าวสาร'
		});
	});

	it('explains a quantity that is zero at stored precision', () => {
		const result = build({ ingredients: [{ ...rice, quantity: '0.00001' }] });
		expect(result).toEqual({ ok: false, reason: 'ปริมาณ ข้าวสาร ต้องมากกว่า 0' });
	});

	it.each([[0], [-1], [Number.NaN]])('reports invalid portions (%s)', (portions) => {
		expect(build({ portions })).toEqual({ ok: false, reason: 'จำนวนจานต้องมากกว่า 0' });
	});

	it('reports a blank label', () => {
		expect(build({ label: '   ' })).toEqual({ ok: false, reason: 'กรุณาระบุชื่อสูตร' });
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
