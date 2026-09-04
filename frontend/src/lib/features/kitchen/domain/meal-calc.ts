import Decimal from 'decimal.js';
import { persistQty, qtyGte, qtyLte, roundQty, subQty } from '$lib/utils/qty';
import type { Recipe, ItemMaster } from '$lib/features/catalog';
import type { SupplyItem } from '$lib/features/supply';
import type {
	KitchenRequisitionInput,
	MealPlan,
	MealPlanHeadcount,
	MealPlanRecipe,
	MealSession,
	MealSessionHeadcount,
	MealService
} from './kitchen';

// Conventional recipe_id for rice — T-26 maps this to the stock item_id.
export const RICE_RECIPE_ID = 'ingredient:rice';

// Default rice consumption per person per meal in grams.
export const DEFAULT_RICE_G_PER_PERSON_MEAL = 150;

// Conversion factor from grams to kilograms.
const GRAMS_PER_KG = 1000;

// Display label and unit for default recipe items.
export const RECIPE_LABELS: Record<string, { label: string; unit: string }> = {
	[RICE_RECIPE_ID]: { label: 'ข้าวสาร', unit: 'g' }
};

// Maps calculated recipe IDs to stock items, units, and scale ratios for requisitions.
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
 * Calculates planned meal ingredients from headcount and per-person rice ratio.
 * Throws if headcount.total or riceGPerMeal is not positive.
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

export interface ResolvedItemMaster {
	stockItemId: string; // Stock supply item ID or unresolved item master ID
	unit: string;
}

/**
 * Matches item masters to stock supply items by matching name and unit.
 * Unmatched items retain their item master ID.
 */
export function resolveItemMasterStock(
	itemMasters: ItemMaster[],
	supplyItems: SupplyItem[]
): Record<string, ResolvedItemMaster> {
	const supplyByName = new Map(supplyItems.map((si) => [si.name.trim().toLowerCase(), si]));

	const info: Record<string, ResolvedItemMaster> = {};
	for (const im of itemMasters) {
		const matched = supplyByName.get(im.name.trim().toLowerCase());
		info[im._id] =
			matched && matched.unit === im.base_unit
				? { stockItemId: matched._id, unit: matched.unit }
				: { stockItemId: im._id, unit: im.base_unit };
	}
	return info;
}

/**
 * Calculates planned meal ingredients scaled from a catalog recipe by headcount.
 * Throws if headcount.total or recipe standard_portions is not positive.
 */
export function calculateMealIngredientsFromRecipe(
	recipe: Recipe,
	headcount: MealPlanHeadcount,
	itemInfo: Record<string, ResolvedItemMaster>,
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
	const recipes: MealPlanRecipe[] = recipe.ingredients.map((ing) => {
		const resolved = itemInfo[ing.item_master_id];
		return {
			recipe_id: resolved?.stockItemId ?? ing.item_master_id,
			planned_qty: new Decimal(ing.quantity).mul(scale).ceil().toNumber(),
			unit: resolved?.unit ?? ing.uom
		};
	});

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
	item_id: string; // Stock supply item ID
	unit: string;
	qty_per_person: number;
}

/**
 * Calculates planned meal ingredients from custom ingredients scaled by headcount.
 * Throws if headcount.total is <= 0 or ingredient list is empty.
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
 * Converts a meal plan into a requisition input payload for stock drawdown.
 * Throws if an ingredient has no stock mapping or unit.
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
		// For BOM or custom recipes, recipe_id is already the stock item ID.
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
 * Evaluates requested requisition items against on-hand stock balances,
 * calculating issuable quantities and shortfalls.
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

// ---- Ticket Formatting & Group Progress ----

/** Formats ticket number: [ShelterCode]-KITCHEN-XXXX */
export function formatTicketNo(shelterCode: string, seq: number): string {
	const code = (shelterCode || 'SH001').toUpperCase();
	return `${code}-KITCHEN-${String(seq).padStart(4, '0')}`;
}

export const TARGET_GROUP_TAGS = ['halal', 'infant', 'soft_food', 'regular', 'volunteer'] as const;
export type TargetGroupTag = (typeof TARGET_GROUP_TAGS)[number];

export const TARGET_GROUP_LABELS: Record<TargetGroupTag | 'everyone', string> = {
	everyone: 'ทุกคน',
	halal: 'ฮาลาล (มุสลิม)',
	infant: 'เด็ก/ทารก',
	soft_food: 'ผู้ป่วย/อาหารอ่อน',
	regular: 'ทั่วไป',
	volunteer: 'เจ้าหน้าที่/อาสาสมัคร'
};

/** Expands 'everyone' into all 5 target group tags. */
export function expandTargetTags(tags: readonly string[]): TargetGroupTag[] {
	if (tags.includes('everyone')) {
		return [...TARGET_GROUP_TAGS];
	}
	const tagSet = new Set<TargetGroupTag>();
	for (const tag of tags) {
		if ((TARGET_GROUP_TAGS as readonly string[]).includes(tag)) {
			tagSet.add(tag as TargetGroupTag);
		}
	}
	return Array.from(tagSet);
}

export interface GroupProgressItem {
	tag: TargetGroupTag;
	label: string;
	target: number;
	actualYield: number;
	isCompleted: boolean;
}

export interface SessionGroupProgress {
	groups: Record<TargetGroupTag, GroupProgressItem>;
	completedCount: number;
	totalCount: number;
	isAllCompleted: boolean;
	summaryText: string;
}

/**
 * Computes 5-group target completion progress for a meal session based on plan actual yields.
 */
export function computeSessionGroupProgress(
	session: MealSession,
	plans: readonly MealPlan[],
	services: readonly MealService[]
): SessionGroupProgress {
	const sessionPlans = plans.filter((p) => p.meal_session_id === session._id);
	const groupYields: Record<TargetGroupTag, number> = {
		halal: 0,
		infant: 0,
		soft_food: 0,
		regular: 0,
		volunteer: 0
	};

	for (const plan of sessionPlans) {
		const service = services.find((s) => s.meal_plan_id === plan._id);
		const portions = service ? (service.actual_yield ?? service.served ?? 0) : 0;
		if (portions > 0) {
			const expanded = expandTargetTags(plan.target_tags ?? []);
			for (const tag of expanded) {
				groupYields[tag] += portions;
			}
		}
	}

	const groups = {} as Record<TargetGroupTag, GroupProgressItem>;
	let completedCount = 0;

	for (const tag of TARGET_GROUP_TAGS) {
		const target = session.target_headcount[tag] ?? 0;
		const actualYield = groupYields[tag] ?? 0;
		const isCompleted = actualYield >= target;
		if (isCompleted) {
			completedCount++;
		}
		groups[tag] = {
			tag,
			label: TARGET_GROUP_LABELS[tag],
			target,
			actualYield,
			isCompleted
		};
	}

	return {
		groups,
		completedCount,
		totalCount: 5,
		isAllCompleted: completedCount === 5,
		summaryText: `${completedCount}/5 กลุ่ม`
	};
}

/** จัดกลุ่ม MealPlan เป็น Record ตาม `_id` */
export function toMealPlanMap(plans?: readonly MealPlan[] | null): Record<string, MealPlan> {
	const map: Record<string, MealPlan> = {};
	if (!plans) return map;
	for (const p of plans) {
		map[p._id] = p;
	}
	return map;
}

/** รวมยอดคนตาม target tags (หากเลือกครบ 5 กลุ่มจะใช้ total) */
export function sumHeadcountByTags(
	targetHeadcount: MealSessionHeadcount | undefined | null,
	tags: readonly TargetGroupTag[]
): number {
	if (!targetHeadcount || tags.length === 0) return 0;
	if (tags.length === TARGET_GROUP_TAGS.length) {
		return targetHeadcount.total || 0;
	}
	return tags.reduce((sum, tag) => sum + (targetHeadcount[tag] || 0), 0);
}

/** ดึงกลุ่มเป้าหมายที่มียอดคน > 0 (ดีฟอลต์เป็น ['regular']) */
export function getActiveTagsFromSession(session?: MealSession | null): TargetGroupTag[] {
	if (!session?.target_headcount) return ['regular'];
	const active = TARGET_GROUP_TAGS.filter((tag) => (session.target_headcount[tag] || 0) > 0);
	return active.length > 0 ? active : ['regular'];
}
