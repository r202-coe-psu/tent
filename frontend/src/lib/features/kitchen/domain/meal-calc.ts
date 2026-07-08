import type {
	KitchenRequisitionInput,
	MealPlan,
	MealPlanHeadcount,
	MealPlanRecipe
} from './kitchen';

// Conventional recipe_id for rice — T-26 maps this to the stock item_id.
// Future ingredients (egg, vegetable, etc.) will add entries here when P-02 ships.
export const RICE_RECIPE_ID = 'ingredient:rice';

// Rice consumption per person per meal (grams). CR-021 removed rice from
// sop_profile.ratios (SOP = shelter planning only) and moved food/ingredient
// coefficients to the kitchen (item_master.consumption_rate / recipe, CR-013).
// That item_master field isn't built yet, so this is the interim kitchen-owned
// source. 150 g matches the existing calc fixtures (100 people → 15000 g).
// TODO(CR-021/CR-013): read from item_master.consumption_rate once it ships.
export const RICE_G_PER_PERSON_MEAL = 150;

// Grams per kg — rice recipes are calculated in grams (SOP ratio precision); the
// stock ledger stores kg (item_master.base_unit). CR-030.
const GRAMS_PER_KG = 1000;

// Maps a calculated recipe_id to the stock item it draws down + its ledger unit
// + how many recipe units make one stock unit. The bridge to T-26 (kitchen
// requisition → stock ledger). CR-022. `unit` must match item_master.base_unit
// (schema.md §2.1); `recipe_per_stock_unit` scales planned_qty (recipe units) to
// qty_requested (stock units) at the T-25→T-26 seam. Rice: recipe grams / 1000 =
// stock kg (CR-030). An ingredient whose recipe unit already equals its stock
// unit (e.g. eggs in ฟอง) uses 1 — so a new item never silently gets /1000.
export const RECIPE_TO_STOCK_ITEM: Record<
	string,
	{ item_id: string; unit: string; recipe_per_stock_unit: number }
> = {
	[RICE_RECIPE_ID]: { item_id: 'item:rice', unit: 'kg', recipe_per_stock_unit: GRAMS_PER_KG }
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
 *
 * `planned_qty` is in recipe units (rice: grams, SOP ratio precision); scales to
 * the stock unit here via `recipe_per_stock_unit` to match `item_master.base_unit`
 * before it reaches the stock ledger (CR-030).
 */
export function toRequisitionInput(plan: MealPlan): KitchenRequisitionInput {
	const items = plan.recipes.map((r) => {
		const stock = RECIPE_TO_STOCK_ITEM[r.recipe_id];
		if (!stock) {
			throw new Error(`toRequisitionInput: no stock item mapping for recipe "${r.recipe_id}"`);
		}
		return {
			item_id: stock.item_id,
			qty_requested: r.planned_qty / stock.recipe_per_stock_unit,
			qty_issued: 0,
			unit: stock.unit
		};
	});
	return { meal_plan_id: plan._id, items };
}

/**
 * Whether on-hand stock covers a requested requisition line.
 *   `ok`      — on-hand ≥ requested (can issue the full amount)
 *   `partial` — 0 < on-hand < requested (can issue some, short the rest)
 *   `out`     — on-hand ≤ 0 (nothing to issue)
 */
export type StockAvailabilityStatus = 'ok' | 'partial' | 'out';

export interface RequisitionLineAssessment {
	item_id: string;
	unit: string;
	qty_requested: number;
	on_hand: number; // signed ledger balance (may be negative if over-issued elsewhere)
	qty_issuable: number; // most that can be issued now: clamp(requested, 0..on_hand)
	shortfall: number; // requested minus what can be issued (0 when fully covered)
	status: StockAvailabilityStatus;
}

/**
 * Compares each requested line against the derived `stock_balance` (on-hand =
 * sum of signed ledger deltas — operations feature), producing the availability
 * a requisition screen needs to show "stock not enough" and offer a partial
 * issue (schema.md §2.6: `qty_issued < requested` = เบิกบางส่วน). Pure — no I/O.
 *
 * `qty_issuable` is clamped to on-hand so a requisition never drives the ledger
 * negative; the caller may still lower it, but not raise it past stock.
 */
export function assessRequisition(
	items: { item_id: string; qty_requested: number; unit: string }[],
	balance: Map<string, number>
): RequisitionLineAssessment[] {
	return items.map((item) => {
		const onHand = balance.get(item.item_id) ?? 0;
		const available = Math.max(0, onHand);
		const qtyIssuable = Math.min(item.qty_requested, available);
		const shortfall = item.qty_requested - qtyIssuable;
		const status: StockAvailabilityStatus =
			available <= 0 ? 'out' : available >= item.qty_requested ? 'ok' : 'partial';
		return {
			item_id: item.item_id,
			unit: item.unit,
			qty_requested: item.qty_requested,
			on_hand: onHand,
			qty_issuable: qtyIssuable,
			shortfall,
			status
		};
	});
}
