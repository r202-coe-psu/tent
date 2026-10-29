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
		standardPortions: 10,
		producedPortions: 50,
		ingredients: [rice],
		...overrides
	});
}

describe('customRecipeInput', () => {
	it('scales quantities from the produced portions to the standard portions', () => {
		const result = build({ label: '  Fried rice ' });
		expect(result).toEqual({
			ok: true,
			input: {
				label: 'Fried rice',
				standard_portions: '10',
				standard_duration_hours: CUSTOM_RECIPE_DURATION_HOURS,
				ingredients: [{ item_master_id: rice.item_master_id, quantity: '0.4', uom: 'kg' }]
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

	it('explains a quantity that rounds to zero at the standard portions', () => {
		const result = build({
			standardPortions: 1,
			producedPortions: 1000,
			ingredients: [{ ...rice, quantity: '0.0001' }]
		});
		expect(result).toEqual({ ok: false, reason: 'ปริมาณ ข้าวสาร ต่อ 1 จานน้อยเกินไป' });
	});

	it.each([[0], [-1], [Number.NaN]])('reports invalid standard portions (%s)', (portions) => {
		expect(build({ standardPortions: portions })).toEqual({
			ok: false,
			reason: 'จำนวนจานมาตรฐานต้องมากกว่า 0'
		});
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
