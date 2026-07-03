import { describe, it, expect } from 'vitest';
import {
	calculateMealIngredients,
	toRequisitionInput,
	assessRequisition,
	RICE_RECIPE_ID
} from './meal-calc';
import type { MealPlan, MealPlanHeadcount } from './kitchen';

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

	it('maps rice recipe (grams) to a stock requisition item, converted to kg (CR-029)', () => {
		const input = toRequisitionInput(plan([{ recipe_id: RICE_RECIPE_ID, planned_qty: 15000 }]));
		expect(input.meal_plan_id).toBe('meal_plan:2026-07-15:lunch');
		expect(input.items).toEqual([
			{ item_id: 'item:rice', qty_requested: 15, qty_issued: 0, unit: 'kg' }
		]);
	});

	it('produces a valid KitchenRequisitionInput (qty_issued starts at 0 for T-26)', () => {
		const input = toRequisitionInput(plan([{ recipe_id: RICE_RECIPE_ID, planned_qty: 7500 }]));
		expect(input.items[0].qty_issued).toBe(0);
		expect(input.items[0].qty_requested).toBeGreaterThan(0);
	});

	it('throws when a recipe has no stock item mapping', () => {
		expect(() =>
			toRequisitionInput(plan([{ recipe_id: 'ingredient:mystery', planned_qty: 10 }]))
		).toThrow(/no stock item mapping/);
	});
});

describe('assessRequisition — stock availability (T-26)', () => {
	const line = (qty_requested: number, item_id = 'item:rice', unit = 'g') => ({
		item_id,
		qty_requested,
		unit
	});

	it('ok: on-hand covers the full request', () => {
		const [a] = assessRequisition([line(15000)], new Map([['item:rice', 20000]]));
		expect(a.status).toBe('ok');
		expect(a.on_hand).toBe(20000);
		expect(a.qty_issuable).toBe(15000);
		expect(a.shortfall).toBe(0);
	});

	it('partial: on-hand covers only part of the request', () => {
		const [a] = assessRequisition([line(15000)], new Map([['item:rice', 9000]]));
		expect(a.status).toBe('partial');
		expect(a.qty_issuable).toBe(9000);
		expect(a.shortfall).toBe(6000);
	});

	it('out: no stock on hand (missing item → 0)', () => {
		const [a] = assessRequisition([line(15000)], new Map());
		expect(a.status).toBe('out');
		expect(a.on_hand).toBe(0);
		expect(a.qty_issuable).toBe(0);
		expect(a.shortfall).toBe(15000);
	});

	it('out: negative balance never yields an issuable qty', () => {
		const [a] = assessRequisition([line(15000)], new Map([['item:rice', -500]]));
		expect(a.status).toBe('out');
		expect(a.qty_issuable).toBe(0);
		expect(a.shortfall).toBe(15000);
	});

	it('exact match counts as ok', () => {
		const [a] = assessRequisition([line(15000)], new Map([['item:rice', 15000]]));
		expect(a.status).toBe('ok');
		expect(a.shortfall).toBe(0);
	});

	it('assesses each line independently against its own item balance', () => {
		const result = assessRequisition(
			[line(100, 'item:rice'), line(50, 'item:egg', 'ฟอง')],
			new Map([
				['item:rice', 100],
				['item:egg', 20]
			])
		);
		expect(result[0].status).toBe('ok');
		expect(result[1].status).toBe('partial');
		expect(result[1].qty_issuable).toBe(20);
	});
});
