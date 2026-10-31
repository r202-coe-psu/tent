import { persistQty, type QtyValue } from '$lib/utils/qty';
import type { RecipeInput } from './catalog';
import { isPositiveQty } from './recipe-quantity';
import { canonicalizeUnitCode, type FallbackUnitDef, type UnitOfMeasure } from './unit-of-measure';

/** The production board does not ask for a cooking time; recipes require one. */
export const CUSTOM_RECIPE_DURATION_HOURS = '1';

export type CustomRecipeIngredient = {
	item_master_id: string;
	name: string;
	quantity: QtyValue;
	uom: string;
};

/** `reason` is Thai copy ready for a toast. */
export type CustomRecipeResult = { ok: true; input: RecipeInput } | { ok: false; reason: string };

/**
 * Builds the recipe input for an ingredient list cooked for `portions` plates; the recipe is
 * stored at that yield. Ingredient units may be legacy Thai labels and are stored as canonical
 * unit codes.
 */
export function customRecipeInput(args: {
	label: string;
	portions: QtyValue;
	ingredients: readonly CustomRecipeIngredient[];
	units?: readonly (UnitOfMeasure | FallbackUnitDef)[] | null;
}): CustomRecipeResult {
	const label = args.label.trim();
	if (!label) return { ok: false, reason: 'กรุณาระบุชื่อสูตร' };
	if (!isPositiveQty(args.portions)) {
		return { ok: false, reason: 'จำนวนจานต้องมากกว่า 0' };
	}

	const ingredients: RecipeInput['ingredients'] = [];
	for (const ingredient of args.ingredients) {
		const uom = canonicalizeUnitCode(ingredient.uom, args.units);
		if (!uom) {
			return { ok: false, reason: `ไม่รู้จักหน่วย "${ingredient.uom}" ของ ${ingredient.name}` };
		}
		if (!isPositiveQty(ingredient.quantity)) {
			return { ok: false, reason: `ปริมาณ ${ingredient.name} ต้องมากกว่า 0` };
		}
		ingredients.push({
			item_master_id: ingredient.item_master_id,
			quantity: persistQty(ingredient.quantity),
			uom
		});
	}

	return {
		ok: true,
		input: {
			label,
			ingredients,
			standard_portions: persistQty(args.portions),
			standard_duration_hours: CUSTOM_RECIPE_DURATION_HOURS
		}
	};
}

/** Case-insensitive, trim-tolerant lookup used to avoid saving a duplicate recipe name. */
export function findRecipeByLabel<T extends { label: string }>(
	recipes: readonly T[] | undefined,
	label: string
): T | undefined {
	const key = label.trim().toLocaleLowerCase();
	if (!key) return undefined;
	return recipes?.find((recipe) => recipe.label.trim().toLocaleLowerCase() === key);
}
