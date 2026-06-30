import type { MealPlanHeadcount, MealPlanRecipe } from './kitchen';

// Conventional recipe_id for rice — T-26 maps this to the stock item_id.
// Future ingredients (egg, vegetable, etc.) will add entries here when P-02 ships.
export const RICE_RECIPE_ID = 'ingredient:rice';

export interface MealCalcSource {
	sop_profile_id: string;
	sop_profile_version: number;
	headcount_as_of: string; // ISO timestamp of when headcount was read
}

export interface MealCalcResult {
	recipes: MealPlanRecipe[];
	calc_source: MealCalcSource;
}

/**
 * Derives the ingredient list for one meal from headcount × SOP ratios.
 *
 * Only rice is calculated now (T-25 scope). P-02 special-needs logic
 * (halal preparation, soft-food, infant formula) will extend this once
 * the design spec ships.
 *
 * Throws if headcount.total is 0 — a meal plan with no occupancy is
 * meaningless and would produce a qty_required = 0 which violates the
 * MealPlanRecipe invariant (planned_qty > 0).
 */
export function calculateMealIngredients(
	headcount: MealPlanHeadcount,
	riceGPerMeal: number,
	sopProfileId: string,
	sopProfileVersion: number,
	headcountAsOf: string
): MealCalcResult {
	if (headcount.total <= 0) {
		throw new Error('calculateMealIngredients: headcount.total must be > 0');
	}
	if (riceGPerMeal <= 0) {
		throw new Error('calculateMealIngredients: riceGPerMeal must be > 0');
	}

	const riceGrams = Math.ceil(headcount.total * riceGPerMeal);

	return {
		recipes: [{ recipe_id: RICE_RECIPE_ID, planned_qty: riceGrams }],
		calc_source: {
			sop_profile_id: sopProfileId,
			sop_profile_version: sopProfileVersion,
			headcount_as_of: headcountAsOf
		}
	};
}
