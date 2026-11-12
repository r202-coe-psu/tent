import type { Dimension } from '../domain/unit-of-measure';
import { wholeQtyError } from '../domain/unit-quantity';

export interface RecipeIngredientQtyIssue {
	index: number;
	message: string;
}

/** Ingredients whose typed quantity breaks the whole-number rule of their unit. */
export function recipeIngredientQtyIssues(
	ingredients: readonly { quantity: string; uom: string }[],
	resolveDimension: (unit: string) => Dimension | undefined
): RecipeIngredientQtyIssue[] {
	return ingredients.flatMap((ing, index) => {
		const message = wholeQtyError(ing.quantity, resolveDimension(ing.uom));
		return message ? [{ index, message }] : [];
	});
}
