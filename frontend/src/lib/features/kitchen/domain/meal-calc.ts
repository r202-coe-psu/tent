import Decimal from 'decimal.js';
import { persistQty, qtyGte, qtyLte, roundQty, subQty } from '$lib/utils/qty';
import { resolveCategoryId, systemCategoryId } from '$lib/features/catalog';
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

export interface TicketItemPayload {
	item_id: string;
	item_name: string;
	unit: string;
	requested_qty: string;
}

/**
 * Converts a meal plan into requisition_ticket item lines (CR-121/CR-141 —
 * replaces `toRequisitionInput` for the ticket flow). References
 * `plan.recipes[].recipe_id` directly as `item_id`, same source
 * `toRequisitionInput` already uses — does not touch `SupplyItem` or
 * name-match anything, so it carries none of `resolveItemMasterStock`'s
 * antipattern forward. `itemMasters` only resolves a display name; when a
 * recipe's `item_id` isn't found there the id itself is shown.
 */
export function toTicketItemInput(
	plan: MealPlan,
	itemMasters: readonly ItemMaster[]
): TicketItemPayload[] {
	const nameOf = (itemId: string) => itemMasters.find((m) => m._id === itemId)?.name ?? itemId;
	return plan.recipes.map((r) => {
		const stock = RECIPE_TO_STOCK_ITEM[r.recipe_id];
		if (stock) {
			return {
				item_id: stock.item_id,
				item_name: nameOf(stock.item_id),
				unit: stock.unit,
				requested_qty: persistQty(new Decimal(r.planned_qty).div(stock.recipe_per_stock_unit))
			};
		}
		if (!r.unit) {
			throw new Error(`toTicketItemInput: no stock item mapping for recipe "${r.recipe_id}"`);
		}
		return {
			item_id: r.recipe_id,
			item_name: nameOf(r.recipe_id),
			unit: r.unit,
			requested_qty: persistQty(r.planned_qty)
		};
	});
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

// ---- Target Group Tags & Progress ----

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

/** Short labels for joining several groups into one row (full labels already contain "/"). */
export const TARGET_GROUP_SHORT_LABELS: Record<TargetGroupTag, string> = {
	halal: 'ฮาลาล',
	infant: 'เด็ก',
	soft_food: 'ผู้ป่วย',
	regular: 'ทั่วไป',
	volunteer: 'จนท.'
};

// Restricted diets first: their food can feed broader groups, never the reverse.
const GROUP_FILL_ORDER: readonly TargetGroupTag[] = [
	'infant',
	'soft_food',
	'halal',
	'volunteer',
	'regular'
];

export interface GroupProgressItem {
	tag: TargetGroupTag;
	label: string;
	target: number;
	/** Plates allocated to this group by priority fill — never double-counted across groups. */
	received: number;
	shortfall: number;
	hasTarget: boolean;
	isCompleted: boolean;
}

export interface SessionGroupProgress {
	groups: Record<TargetGroupTag, GroupProgressItem>;
	activeTags: TargetGroupTag[];
	noTargetTags: TargetGroupTag[];
	completedCount: number;
	totalCount: number;
	isAllCompleted: boolean;
	totalTarget: number;
	totalProduced: number;
	surplus: number;
	summaryText: string;
}

interface PlateBatch {
	tags: readonly TargetGroupTag[];
	portions: number;
}

/**
 * Allocates plates group by group in GROUP_FILL_ORDER (CR-201 R3). Each unit of need is served by
 * an augmenting path: a menu with spare plates, or a menu moved over from a group that another
 * menu can refill. Filled groups never lose plates, and the result ignores menu input order.
 */
function allocateGroupPlates(
	batches: readonly PlateBatch[],
	target: Record<TargetGroupTag, number>
): { received: Record<TargetGroupTag, number>; surplus: number } {
	const flow = batches.map(() => ({}) as Partial<Record<TargetGroupTag, number>>);
	const spare = batches.map((b) => b.portions);
	const received = {} as Record<TargetGroupTag, number>;
	for (const tag of TARGET_GROUP_TAGS) received[tag] = 0;

	for (const goal of GROUP_FILL_ORDER) {
		while (received[goal] < target[goal]) {
			// BFS over groups; moved[h] = menu that can shift its plates from h to `from`
			const moved = new Map<TargetGroupTag, { from: TargetGroupTag; menu: number }>();
			const visited = new Set<TargetGroupTag>([goal]);
			const queue: TargetGroupTag[] = [goal];
			let end: { group: TargetGroupTag; menu: number } | null = null;

			for (let q = 0; q < queue.length && !end; q++) {
				const group = queue[q];
				const menus = batches.flatMap((b, m) => (b.tags.includes(group) ? [m] : []));
				const source = menus.find((m) => spare[m] > 0);
				if (source !== undefined) {
					end = { group, menu: source };
					break;
				}
				for (const m of menus) {
					for (const h of GROUP_FILL_ORDER) {
						if (visited.has(h) || (flow[m][h] ?? 0) <= 0) continue;
						visited.add(h);
						moved.set(h, { from: group, menu: m });
						queue.push(h);
					}
				}
			}
			if (!end) break;

			let amount = Math.min(spare[end.menu], target[goal] - received[goal]);
			for (let cur = end.group; cur !== goal;) {
				const step = moved.get(cur)!;
				amount = Math.min(amount, flow[step.menu][cur] ?? 0);
				cur = step.from;
			}

			spare[end.menu] -= amount;
			flow[end.menu][end.group] = (flow[end.menu][end.group] ?? 0) + amount;
			for (let cur = end.group; cur !== goal;) {
				const step = moved.get(cur)!;
				flow[step.menu][cur] = (flow[step.menu][cur] ?? 0) - amount;
				flow[step.menu][step.from] = (flow[step.menu][step.from] ?? 0) + amount;
				cur = step.from;
			}
			received[goal] += amount;
		}
	}

	return { received, surplus: spare.reduce((sum, n) => sum + n, 0) };
}

/**
 * Computes per-group plate progress for a meal session by priority fill: groups are filled in
 * GROUP_FILL_ORDER, each only from menus tagged for it, re-routing plates between menus so that
 * partially overlapping tags still fill as many groups as possible; leftover is surplus.
 */
export function computeSessionGroupProgress(
	session: MealSession,
	plans: readonly MealPlan[],
	services: readonly MealService[]
): SessionGroupProgress {
	const target = {} as Record<TargetGroupTag, number>;
	for (const tag of TARGET_GROUP_TAGS) target[tag] = session.target_headcount[tag] ?? 0;

	const entries = plans
		.filter((p) => p.meal_session_id === session._id)
		.map((plan) => {
			const service = services.find((s) => s.meal_plan_id === plan._id);
			const portions = service ? (service.actual_yield ?? service.served ?? 0) : 0;
			const tags = expandTargetTags(plan.target_tags ?? []);
			return { tags: tags.length > 0 ? tags : (['regular'] as TargetGroupTag[]), portions };
		})
		.filter((e) => e.portions > 0);

	const totalProduced = entries.reduce((sum, e) => sum + e.portions, 0);
	const { received, surplus } = allocateGroupPlates(entries, target);

	const groups = {} as Record<TargetGroupTag, GroupProgressItem>;
	const activeTags: TargetGroupTag[] = [];
	const noTargetTags: TargetGroupTag[] = [];
	let completedCount = 0;
	let totalTarget = 0;

	for (const tag of TARGET_GROUP_TAGS) {
		const target = session.target_headcount[tag] ?? 0;
		const hasTarget = target > 0;
		const isCompleted = hasTarget && received[tag] >= target;
		if (hasTarget) activeTags.push(tag);
		else noTargetTags.push(tag);
		if (isCompleted) completedCount++;
		totalTarget += target;
		groups[tag] = {
			tag,
			label: TARGET_GROUP_LABELS[tag],
			target,
			received: received[tag],
			shortfall: Math.max(0, target - received[tag]),
			hasTarget,
			isCompleted
		};
	}

	const totalCount = activeTags.length;
	return {
		groups,
		activeTags,
		noTargetTags,
		completedCount,
		totalCount,
		isAllCompleted: totalCount > 0 && completedCount === totalCount,
		totalTarget,
		totalProduced,
		surplus,
		summaryText: totalCount === 0 ? 'ไม่มีเป้าหมาย' : `${completedCount}/${totalCount} กลุ่มครบ`
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

/** item master ที่เลือกเป็นวัตถุดิบทำอาหารได้: หมวดอาหาร (id หรือชื่อเดิม) และยังใช้งานอยู่ */
export function selectableFoodIngredients<
	T extends Pick<ItemMaster, 'category' | 'deactivated' | 'merged_into'>
>(masters: readonly T[] | undefined): T[] {
	const food = systemCategoryId('FOOD');
	return (masters ?? []).filter(
		(m) => !m.deactivated && !m.merged_into && resolveCategoryId(m.category, []) === food
	);
}
