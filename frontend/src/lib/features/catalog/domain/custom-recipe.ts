import { parseQty, persistQty, qtyGt, type QtyValue } from '$lib/utils/qty';
import type { RecipeInput } from './catalog';

export type CustomRecipeIngredient = { item_master_id: string; quantity: QtyValue; uom: string };

function positive(value: QtyValue, field: string): QtyValue {
	if (!qtyGt(persistQty(value), 0)) throw new Error(`${field} must be greater than 0`);
	return value;
}

/**
 * Builds the recipe input for an ingredient list sized for `producedPortions`, persisted at
 * `standardPortions` (recipe quantities are always stored at the standard yield).
 */
export function customRecipeInput(args: {
	label: string;
	standardPortions: QtyValue;
	producedPortions: QtyValue;
	ingredients: readonly CustomRecipeIngredient[];
}): RecipeInput {
	const standard = parseQty(positive(args.standardPortions, 'standardPortions'));
	const produced = parseQty(positive(args.producedPortions, 'producedPortions'));
	return {
		label: args.label.trim(),
		ingredients: args.ingredients.map((ingredient) => ({
			item_master_id: ingredient.item_master_id,
			quantity: persistQty(parseQty(ingredient.quantity).mul(standard).div(produced)),
			uom: ingredient.uom
		})),
		standard_portions: persistQty(standard),
		standard_duration_hours: '1'
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
