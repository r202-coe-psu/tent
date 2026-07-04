import type {
	KitchenRequisitionInput,
	MealPlan,
	MealPlanHeadcount,
	MealPlanRecipe
} from './kitchen';

// Conventional recipe_id for rice — T-26 maps this to the stock item_id.
// Future ingredients (egg, vegetable, etc.) will add entries here when P-02 ships.
export const RICE_RECIPE_ID = 'ingredient:rice';

// Maps a calculated recipe_id to the stock item it draws down + its unit.
// The bridge to T-26 (kitchen requisition → stock ledger). CR-022.
export const RECIPE_TO_STOCK_ITEM: Record<string, { item_id: string; unit: string }> = {
	[RICE_RECIPE_ID]: { item_id: 'item:rice', unit: 'g' }
};

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

/**
 * Adapts a meal plan into a {@link KitchenRequisitionInput} — the handoff to
 * T-26 (FR-40). Each recipe becomes a requested stock item; `qty_issued`
 * starts at 0 because the actual issued amount (partial when stock is short)
 * is decided by T-26 at issue time. Pure: no I/O, no stock lookup.
 *
 * Throws if a recipe has no stock mapping — a plan must not silently produce a
 * requisition that skips an ingredient.
 */
export function toRequisitionInput(plan: MealPlan): KitchenRequisitionInput {
	const items = plan.recipes.map((r) => {
		const stock = RECIPE_TO_STOCK_ITEM[r.recipe_id];
		if (!stock) {
			throw new Error(`toRequisitionInput: no stock item mapping for recipe "${r.recipe_id}"`);
		}
		return {
			item_id: stock.item_id,
			qty_requested: r.planned_qty,
			qty_issued: 0,
			unit: stock.unit
		};
	});
	return { meal_plan_id: plan._id, items };
}
