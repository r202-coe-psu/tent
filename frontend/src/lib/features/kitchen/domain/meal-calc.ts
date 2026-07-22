import Decimal from 'decimal.js';
import { persistQty, qtyGte, qtyLte, roundQty, subQty } from '$lib/utils/qty';
import type { Recipe } from '$lib/features/catalog';
import type {
	KitchenRequisitionInput,
	MealPlan,
	MealPlanHeadcount,
	MealPlanRecipe
} from './kitchen';

// Conventional recipe_id for rice — T-26 maps this to the stock item_id.
export const RICE_RECIPE_ID = 'ingredient:rice';
export const EGG_RECIPE_ID = 'ingredient:egg';
export const VEGETABLE_RECIPE_ID = 'ingredient:vegetable';

// Rice consumption per person per meal (grams). CR-021 removed rice from
// sop_profile.ratios (SOP = shelter planning only) and moved food/ingredient
// coefficients to the kitchen (item_master.consumption_rate / recipe, CR-013).
// That item_master field isn't built yet, so this is the interim kitchen-owned
// default. 150 g matches the existing calc fixtures (100 people → 15000 g).
// TODO(CR-021/CR-013): read from item_master.consumption_rate once it ships.
export const DEFAULT_RICE_G_PER_PERSON_MEAL = 150;

// Grams per kg — rice/vegetable recipes are calculated in grams (SOP ratio
// precision); the stock ledger stores kg (item_master.base_unit). CR-030.
const GRAMS_PER_KG = 1000;

// Display label/unit for a recipe row — covers every id calculateMealIngredients
// can produce; a recipe_id missing here just falls back to showing its raw id.
export const RECIPE_LABELS: Record<string, { label: string; unit: string }> = {
	[RICE_RECIPE_ID]: { label: 'ข้าวสาร', unit: 'g' },
	[EGG_RECIPE_ID]: { label: 'ไข่ไก่', unit: 'ฟอง' },
	[VEGETABLE_RECIPE_ID]: { label: 'ผักรวม', unit: 'g' }
};

// Maps a calculated recipe_id to the stock item it draws down + its ledger unit
// + how many recipe units make one stock unit. The bridge to T-26 (kitchen
// requisition → stock ledger). CR-022. `unit` must match item_master.base_unit
// (schema.md §2.1); `recipe_per_stock_unit` scales planned_qty (recipe units) to
// qty_requested (stock units) at the T-25→T-26 seam. Rice/vegetable: recipe
// grams / 1000 = stock kg (CR-030). An ingredient whose recipe unit already
// equals its stock unit (e.g. eggs in ฟอง) uses 1 — so a new item never
// silently gets /1000.
export const RECIPE_TO_STOCK_ITEM: Record<
	string,
	{ item_id: string; unit: string; recipe_per_stock_unit: number }
> = {
	[RICE_RECIPE_ID]: { item_id: 'item:rice', unit: 'kg', recipe_per_stock_unit: GRAMS_PER_KG },
	[EGG_RECIPE_ID]: { item_id: 'item:egg', unit: 'piece', recipe_per_stock_unit: 1 },
	[VEGETABLE_RECIPE_ID]: {
		item_id: 'item:vegetable',
		unit: 'kg',
		recipe_per_stock_unit: GRAMS_PER_KG
	}
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
 * Derives the ingredient list for one meal from headcount × SOP ratio (rice
 * only — the sole ingredient with a real per-person coefficient today). The
 * previous 3 fixed egg/vegetable menu presets were demo-only mock data with no
 * SOP ratio backing them; removed per owner request. A real multi-ingredient
 * menu now comes from a catalog Recipe (BOM) — see
 * {@link calculateMealIngredientsFromRecipe} — authored on `/back-office/catalog`.
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
	const recipes: MealPlanRecipe[] = [{ recipe_id: RICE_RECIPE_ID, planned_qty: riceGrams }];

	return {
		recipes,
		calc_source: {
			sop_profile_id: sopProfileId,
			sop_profile_version: sopProfileVersion,
			headcount_as_of: headcountAsOf
		}
	};
}

/**
 * Derives the ingredient list for one meal from a catalog Recipe (BOM) instead
 * of the fixed SOP-ratio menus — each recipe.ingredient scales from its
 * standard_portions to the plan's actual headcount. `itemUnits` supplies the
 * base_unit of each referenced item_master (catalog Ingredient.uom is not
 * guaranteed to match it); falls back to the ingredient's own uom if missing.
 *
 * Owner decision: a catalog item_master_id is used as-is for the stock_ledger
 * item_id (no separate stock-item mapping) — see toRequisitionInput's
 * RECIPE_TO_STOCK_ITEM-less fallback branch below.
 *
 * Throws if headcount.total is 0 or the recipe's standard_portions isn't a
 * positive number — same invariant as {@link calculateMealIngredients}.
 */
export function calculateMealIngredientsFromRecipe(
	recipe: Recipe,
	headcount: MealPlanHeadcount,
	itemUnits: Record<string, string>,
	sopProfileId: string,
	sopProfileVersion: number,
	headcountAsOf: string
): MealCalcResult {
	if (headcount.total <= 0) {
		throw new Error('calculateMealIngredientsFromRecipe: headcount.total must be > 0');
	}
	const portions = Number(recipe.standard_portions);
	if (!(portions > 0)) {
		throw new Error('calculateMealIngredientsFromRecipe: recipe.standard_portions must be > 0');
	}

	const scale = new Decimal(headcount.total).div(portions);
	const recipes: MealPlanRecipe[] = recipe.ingredients.map((ing) => ({
		recipe_id: ing.item_master_id,
		planned_qty: new Decimal(ing.quantity).mul(scale).ceil().toNumber(),
		unit: itemUnits[ing.item_master_id] ?? ing.uom
	}));

	return {
		recipes,
		calc_source: {
			sop_profile_id: sopProfileId,
			sop_profile_version: sopProfileVersion,
			headcount_as_of: headcountAsOf
		}
	};
}

export interface CustomIngredientInput {
	item_id: string; // a real `supply_item` `_id` (item:*) — already stock-linked
	unit: string; // the supply_item's fixed unit, so no conversion is needed later
	qty_per_person: number;
}

/**
 * Derives the ingredient list for one meal from an ad-hoc, staff-typed
 * ingredient list ("กำหนดสูตรเอง (Custom)") instead of the fixed SOP-ratio rice
 * calc or a saved catalog Recipe (BOM) — each `qty_per_person` scales by the
 * plan's headcount, same mental model as rice's `riceGPerMeal`. Ingredients
 * must reference a real `supply_item` (not a free-typed name) so the plan can
 * actually be เบิก later — unlike BOM-sourced plans, these have real stock.
 *
 * Throws if headcount.total is 0 or the item list is empty.
 */
export function calculateMealIngredientsFromCustom(
	items: CustomIngredientInput[],
	headcount: MealPlanHeadcount,
	sopProfileId: string,
	sopProfileVersion: number,
	headcountAsOf: string
): MealCalcResult {
	if (headcount.total <= 0) {
		throw new Error('calculateMealIngredientsFromCustom: headcount.total must be > 0');
	}
	if (items.length === 0) {
		throw new Error('calculateMealIngredientsFromCustom: at least one ingredient required');
	}

	const recipes: MealPlanRecipe[] = items.map((i) => ({
		recipe_id: i.item_id,
		planned_qty: Math.ceil(headcount.total * i.qty_per_person),
		unit: i.unit
	}));

	return {
		recipes,
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
		if (stock) {
			const qtyRequested = persistQty(new Decimal(r.planned_qty).div(stock.recipe_per_stock_unit));
			return {
				item_id: stock.item_id,
				qty_requested: qtyRequested,
				qty_issued: '0',
				unit: stock.unit
			};
		}
		// BOM (calculateMealIngredientsFromRecipe) or custom
		// (calculateMealIngredientsFromCustom) recipe — no static mapping,
		// recipe_id IS the stock item_id already and planned_qty is already in
		// that item's stock unit, so no conversion.
		if (!r.unit) {
			throw new Error(`toRequisitionInput: no stock item mapping for recipe "${r.recipe_id}"`);
		}
		return {
			item_id: r.recipe_id,
			qty_requested: persistQty(r.planned_qty),
			qty_issued: '0',
			unit: r.unit
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
	qty_requested: string;
	on_hand: string; // signed ledger balance (may be negative if over-issued elsewhere)
	qty_issuable: string; // most that can be issued now: clamp(requested, 0..on_hand)
	shortfall: string; // requested minus what can be issued (0 when fully covered)
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
	items: { item_id: string; qty_requested: string | number; unit: string }[],
	balance: Map<string, string>
): RequisitionLineAssessment[] {
	return items.map((item) => {
		const onHand = roundQty(balance.get(item.item_id) ?? '0');
		const available = qtyGte(onHand, 0) ? onHand : '0';
		const requested = roundQty(item.qty_requested);
		const qtyIssuable = qtyLte(requested, available) ? requested : available;
		const shortfall = subQty(requested, qtyIssuable);
		const status: StockAvailabilityStatus = qtyLte(available, 0)
			? 'out'
			: qtyGte(available, requested)
				? 'ok'
				: 'partial';
		return {
			item_id: item.item_id,
			unit: item.unit,
			qty_requested: requested,
			on_hand: onHand,
			qty_issuable: qtyIssuable,
			shortfall,
			status
		};
	});
}
