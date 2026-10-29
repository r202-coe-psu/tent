import { persistQty, type QtyValue } from '$lib/utils/qty';
import type { RecipeInput } from './catalog';
import { isPositiveQty, scaleQuantityToPortions } from './recipe-quantity';
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
 * Builds the recipe input for an ingredient list sized for `producedPortions`, persisted at
 * `standardPortions` (recipe quantities are always stored at the standard yield). Ingredient
 * units may be legacy Thai labels and are stored as canonical unit codes.
 */
export function customRecipeInput(args: {
	label: string;
	standardPortions: QtyValue;
	producedPortions: QtyValue;
	ingredients: readonly CustomRecipeIngredient[];
	units?: readonly (UnitOfMeasure | FallbackUnitDef)[] | null;
}): CustomRecipeResult {
	const label = args.label.trim();
	if (!label) return { ok: false, reason: 'กรุณาระบุชื่อสูตร' };
	if (!isPositiveQty(args.standardPortions)) {
		return { ok: false, reason: 'จำนวนจานมาตรฐานต้องมากกว่า 0' };
	}
	if (!isPositiveQty(args.producedPortions)) {
		return { ok: false, reason: 'จำนวนจานเป้าหมายต้องมากกว่า 0' };
	}

	const ingredients: RecipeInput['ingredients'] = [];
	for (const ingredient of args.ingredients) {
		const uom = canonicalizeUnitCode(ingredient.uom, args.units);
		if (!uom) {
			return { ok: false, reason: `ไม่รู้จักหน่วย "${ingredient.uom}" ของ ${ingredient.name}` };
		}
		const quantity = scaleQuantityToPortions(
			ingredient.quantity,
			args.producedPortions,
			args.standardPortions
		);
		if (!isPositiveQty(quantity)) {
			return {
				ok: false,
				reason: `ปริมาณ ${ingredient.name} ต่อ ${persistQty(args.standardPortions)} จานน้อยเกินไป`
			};
		}
		ingredients.push({ item_master_id: ingredient.item_master_id, quantity, uom });
	}

	return {
		ok: true,
		input: {
			label,
			ingredients,
			standard_portions: persistQty(args.standardPortions),
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
