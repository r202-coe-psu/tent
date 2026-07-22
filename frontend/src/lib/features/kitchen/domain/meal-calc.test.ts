import { describe, it, expect } from 'vitest';
import {
	calculateMealIngredients,
	calculateMealIngredientsFromRecipe,
	resolveItemMasterStock,
	toRequisitionInput,
	assessRequisition,
	RICE_RECIPE_ID,
	RECIPE_TO_STOCK_ITEM,
	type ResolvedItemMaster
} from './meal-calc';
import type { MealPlan, MealPlanHeadcount } from './kitchen';
import type { Recipe, ItemMaster } from '$lib/features/catalog';
import type { SupplyItem } from '$lib/features/supply';

const SOP_ID = 'sop_profile:TEST001';
const SOP_VERSION = 1;
const AS_OF = '2026-06-26T08:00:00.000Z';

const headcount = (total: number, halal = 0, soft_food = 0, infant = 0): MealPlanHeadcount => ({
	total,
	halal,
	soft_food,
	infant
});

describe('calculateMealIngredients', () => {
	it('manual check: 100 people × 150 g/meal = 15 000 g rice', () => {
		const result = calculateMealIngredients(headcount(100), 150, SOP_ID, SOP_VERSION, AS_OF);
		expect(result.recipes).toHaveLength(1);
		expect(result.recipes[0]).toEqual({ recipe_id: RICE_RECIPE_ID, planned_qty: 15000 });
	});

	it('manual check: 53 people × 150 g/meal = 7 950 g rice', () => {
		const result = calculateMealIngredients(headcount(53), 150, SOP_ID, SOP_VERSION, AS_OF);
		expect(result.recipes[0].planned_qty).toBe(7950);
	});

	it('rounds up fractional grams (ceil)', () => {
		// 10 people × 175 g = 1 750 g — exact
		expect(
			calculateMealIngredients(headcount(10), 175, SOP_ID, SOP_VERSION, AS_OF).recipes[0]
				.planned_qty
		).toBe(1750);

		// 7 people × 150 g = 1 050 g — exact
		expect(
			calculateMealIngredients(headcount(7), 150, SOP_ID, SOP_VERSION, AS_OF).recipes[0].planned_qty
		).toBe(1050);

		// 3 people × 100.5 g = 301.5 → ceiled to 302
		expect(
			calculateMealIngredients(headcount(3), 100.5, SOP_ID, SOP_VERSION, AS_OF).recipes[0]
				.planned_qty
		).toBe(302);
	});

	it('embeds calc_source with correct profile id + version + as_of', () => {
		const result = calculateMealIngredients(headcount(50), 150, SOP_ID, 3, AS_OF);
		expect(result.calc_source).toEqual({
			sop_profile_id: SOP_ID,
			sop_profile_version: 3,
			headcount_as_of: AS_OF
		});
	});

	it('throws when headcount.total is 0', () => {
		expect(() => calculateMealIngredients(headcount(0), 150, SOP_ID, SOP_VERSION, AS_OF)).toThrow(
			/headcount.total must be > 0/
		);
	});

	it('throws when riceGPerMeal is 0', () => {
		expect(() => calculateMealIngredients(headcount(100), 0, SOP_ID, SOP_VERSION, AS_OF)).toThrow(
			/riceGPerMeal must be > 0/
		);
	});

	it('halal/soft_food/infant sub-counts do not affect rice total (P-02 pending)', () => {
		// All headcount subgroups are included in total; separate recipe entries
		// for special-needs prep will be added after P-02 design ships.
		const mixed = calculateMealIngredients(
			headcount(100, 30, 10, 5),
			150,
			SOP_ID,
			SOP_VERSION,
			AS_OF
		);
		const plain = calculateMealIngredients(headcount(100), 150, SOP_ID, SOP_VERSION, AS_OF);
		expect(mixed.recipes[0].planned_qty).toBe(plain.recipes[0].planned_qty);
	});
});

describe('calculateMealIngredientsFromRecipe — catalog Recipe (BOM)', () => {
	const recipe = (ingredients: Recipe['ingredients'], standardPortions = '100'): Recipe => ({
		_id: 'recipe:test001',
		type: 'recipe',
		schema_v: 3,
		created_at: AS_OF,
		updated_at: AS_OF,
		created_by: 'tester',
		label: 'ทดสอบ',
		ingredients,
		standard_portions: standardPortions,
		standard_duration_hours: '1',
		is_default: false
	});

	it('scales each ingredient from standard_portions to actual headcount', () => {
		const r = recipe([{ item_master_id: 'item_master:rice', quantity: '200', uom: 'g' }], '100');
		const result = calculateMealIngredientsFromRecipe(
			r,
			headcount(70),
			{},
			SOP_ID,
			SOP_VERSION,
			AS_OF
		);
		// 200 g per 100 portions × 70 headcount = 140 g
		expect(result.recipes[0].planned_qty).toBe(140);
	});

	it('resolves a linked ingredient to its real stock item_id + unit', () => {
		const r = recipe([{ item_master_id: 'item_master:rice', quantity: '1', uom: 'ชิ้น' }]);
		const itemInfo: Record<string, ResolvedItemMaster> = {
			'item_master:rice': { stockItemId: 'item:rice', unit: 'kg' }
		};
		const result = calculateMealIngredientsFromRecipe(
			r,
			headcount(100),
			itemInfo,
			SOP_ID,
			SOP_VERSION,
			AS_OF
		);
		expect(result.recipes[0].recipe_id).toBe('item:rice');
		expect(result.recipes[0].unit).toBe('kg');
	});

	it('falls back to the item_master_id + recipe uom when unresolved (no link yet)', () => {
		const r = recipe([{ item_master_id: 'item_master:mystery', quantity: '1', uom: 'ชิ้น' }]);
		const result = calculateMealIngredientsFromRecipe(
			r,
			headcount(100),
			{},
			SOP_ID,
			SOP_VERSION,
			AS_OF
		);
		expect(result.recipes[0].recipe_id).toBe('item_master:mystery');
		expect(result.recipes[0].unit).toBe('ชิ้น');
	});

	it('resolves ingredients independently — partial linking leaves the rest unresolved', () => {
		const r = recipe([
			{ item_master_id: 'item_master:rice', quantity: '1', uom: 'ชิ้น' },
			{ item_master_id: 'item_master:unlinked', quantity: '1', uom: 'ชิ้น' }
		]);
		const itemInfo: Record<string, ResolvedItemMaster> = {
			'item_master:rice': { stockItemId: 'item:rice', unit: 'kg' }
		};
		const result = calculateMealIngredientsFromRecipe(
			r,
			headcount(100),
			itemInfo,
			SOP_ID,
			SOP_VERSION,
			AS_OF
		);
		expect(result.recipes[0].recipe_id).toBe('item:rice');
		expect(result.recipes[1].recipe_id).toBe('item_master:unlinked');
	});

	it('throws when headcount.total is 0', () => {
		const r = recipe([{ item_master_id: 'item_master:rice', quantity: '1', uom: 'g' }]);
		expect(() =>
			calculateMealIngredientsFromRecipe(r, headcount(0), {}, SOP_ID, SOP_VERSION, AS_OF)
		).toThrow(/headcount.total must be > 0/);
	});

	it('throws when standard_portions is not positive', () => {
		const r = recipe([{ item_master_id: 'item_master:rice', quantity: '1', uom: 'g' }], '0');
		expect(() =>
			calculateMealIngredientsFromRecipe(r, headcount(100), {}, SOP_ID, SOP_VERSION, AS_OF)
		).toThrow(/standard_portions must be > 0/);
	});
});

describe('resolveItemMasterStock — auto-match item_master ↔ supply_item', () => {
	const itemMaster = (overrides: Partial<ItemMaster> = {}): ItemMaster => ({
		_id: 'item_master:rice',
		type: 'item_master',
		schema_v: 3,
		created_at: AS_OF,
		updated_at: AS_OF,
		created_by: 'tester',
		name: 'ข้าวสาร',
		base_unit: 'kg',
		conversions: [],
		distribution_type: 'consumable',
		target_audience_type: 'all',
		target_restrictions: {},
		is_default: false,
		...overrides
	});

	const supplyItem = (overrides: Partial<SupplyItem> = {}): SupplyItem => ({
		_id: 'item:rice',
		type: 'supply_item',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: AS_OF,
		updated_at: AS_OF,
		created_by: 'seed',
		name: 'ข้าวสาร',
		category: 'food',
		unit: 'kg',
		reorder_level: null,
		perishable: false,
		...overrides
	});

	it('auto-matches by name (trimmed, case-insensitive)', () => {
		const im = itemMaster({ name: ' ข้าวสาร ' });
		const si = supplyItem({ name: 'ข้าวสาร' });
		const info = resolveItemMasterStock([im], [si]);
		expect(info[im._id]).toEqual({ stockItemId: si._id, unit: si.unit });
	});

	it('falls back to the item_master itself when nothing matches', () => {
		const im = itemMaster({ name: 'ของลึกลับ' });
		const info = resolveItemMasterStock([im], [supplyItem()]);
		expect(info[im._id]).toEqual({ stockItemId: im._id, unit: im.base_unit });
	});
});

describe('toRequisitionInput — T-26 handoff (CR-022)', () => {
	const plan = (recipes: MealPlan['recipes']): MealPlan => ({
		_id: 'meal_plan:2026-07-15:lunch',
		type: 'meal_plan',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: AS_OF,
		updated_at: AS_OF,
		created_by: 'tester',
		date: '2026-07-15',
		meal: 'lunch',
		headcount: headcount(100),
		recipes,
		status: 'confirmed'
	});

	it('maps rice recipe (grams) to a stock requisition item, converted to kg (CR-030)', () => {
		const input = toRequisitionInput(plan([{ recipe_id: RICE_RECIPE_ID, planned_qty: 15000 }]));
		expect(input.meal_plan_id).toBe('meal_plan:2026-07-15:lunch');
		expect(input.items).toEqual([
			{ item_id: 'item:rice', qty_requested: '15', qty_issued: '0', unit: 'kg' }
		]);
	});

	it('produces a valid KitchenRequisitionInput (qty_issued starts at 0 for T-26)', () => {
		const input = toRequisitionInput(plan([{ recipe_id: RICE_RECIPE_ID, planned_qty: 7500 }]));
		expect(input.items[0].qty_issued).toBe('0');
		expect(input.items[0].qty_requested).toBe('7.5'); // 7 500 g → 7.5 kg (fractional kg is valid)
	});

	it('scales by the item mapping, not a hardcoded /1000 (CR-030)', () => {
		// The divisor comes from recipe_per_stock_unit — an item whose recipe unit
		// already equals its stock unit (scale 1) must NOT get silently divided.
		expect(RECIPE_TO_STOCK_ITEM[RICE_RECIPE_ID].recipe_per_stock_unit).toBe(1000);
		const input = toRequisitionInput(plan([{ recipe_id: RICE_RECIPE_ID, planned_qty: 15000 }]));
		expect(input.items[0].qty_requested).toBe('15');
	});

	it('throws when a recipe has no stock item mapping', () => {
		expect(() =>
			toRequisitionInput(plan([{ recipe_id: 'ingredient:mystery', planned_qty: 10 }]))
		).toThrow(/no stock item mapping/);
	});
});

describe('assessRequisition — stock availability (T-26)', () => {
	// Production flow assesses requisitions in kg (item_master.base_unit, CR-030)
	// — toRequisitionInput already converts grams → kg before this ever runs, so
	// these units must reflect kg, not the pre-conversion gram figures.
	const line = (qty_requested: number, item_id = 'item:rice', unit = 'kg') => ({
		item_id,
		qty_requested,
		unit
	});

	it('ok: on-hand covers the full request', () => {
		const [a] = assessRequisition([line(15)], new Map([['item:rice', '20']]));
		expect(a.status).toBe('ok');
		expect(a.on_hand).toBe('20');
		expect(a.qty_issuable).toBe('15');
		expect(a.shortfall).toBe('0');
	});

	it('partial: on-hand covers only part of the request', () => {
		const [a] = assessRequisition([line(15)], new Map([['item:rice', '9']]));
		expect(a.status).toBe('partial');
		expect(a.qty_issuable).toBe('9');
		expect(a.shortfall).toBe('6');
	});

	it('out: no stock on hand (missing item → 0)', () => {
		const [a] = assessRequisition([line(15)], new Map());
		expect(a.status).toBe('out');
		expect(a.on_hand).toBe('0');
		expect(a.qty_issuable).toBe('0');
		expect(a.shortfall).toBe('15');
	});

	it('out: negative balance never yields an issuable qty', () => {
		const [a] = assessRequisition([line(15)], new Map([['item:rice', '-0.5']]));
		expect(a.status).toBe('out');
		expect(a.qty_issuable).toBe('0');
		expect(a.shortfall).toBe('15');
	});

	it('exact match counts as ok', () => {
		const [a] = assessRequisition([line(15)], new Map([['item:rice', '15']]));
		expect(a.status).toBe('ok');
		expect(a.shortfall).toBe('0');
	});

	it('treats float-noisy near-equal on-hand as ok with zero shortfall', () => {
		const [a] = assessRequisition([line(0.3)], new Map([['item:rice', String(0.1 + 0.2)]]));
		expect(a.status).toBe('ok');
		expect(a.shortfall).toBe('0');
		expect(a.qty_issuable).toBe('0.3');
	});

	it('assesses each line independently against its own item balance', () => {
		const result = assessRequisition(
			[line(10, 'item:rice'), line(5, 'item:egg', 'ฟอง')],
			new Map([
				['item:rice', '10'],
				['item:egg', '2']
			])
		);
		expect(result[0].status).toBe('ok');
		expect(result[1].status).toBe('partial');
		expect(result[1].qty_issuable).toBe('2');
	});
});

describe('toRequisitionInput → assessRequisition — kg end-to-end (CR-030)', () => {
	const plan = (recipes: MealPlan['recipes']): MealPlan => ({
		_id: 'meal_plan:2026-07-15:lunch',
		type: 'meal_plan',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: AS_OF,
		updated_at: AS_OF,
		created_by: 'tester',
		date: '2026-07-15',
		meal: 'lunch',
		headcount: headcount(100),
		recipes,
		status: 'confirmed'
	});

	it('assesses a real plan against a kg on-hand balance without unit mismatch', () => {
		const input = toRequisitionInput(plan([{ recipe_id: RICE_RECIPE_ID, planned_qty: 15000 }]));
		const [a] = assessRequisition(input.items, new Map([['item:rice', '200']]));
		expect(a.qty_requested).toBe('15'); // 15 000 g → 15 kg, not 15 000
		expect(a.on_hand).toBe('200');
		expect(a.status).toBe('ok');
		expect(a.qty_issuable).toBe('15');
	});
});
