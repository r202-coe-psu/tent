import { describe, it, expect } from 'vitest';
import {
	createMealPlan,
	createKitchenRequisition,
	createMealService,
	isMealPlan,
	isKitchenRequisition,
	isMealService
} from './kitchen';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'kitchen_staff' };

// ---- MealPlan ----

describe('createMealPlan', () => {
	it('generates deterministic _id from date + meal', () => {
		const plan = createMealPlan(
			{
				date: '2026-07-15',
				meal: 'dinner',
				headcount: { total: 100, halal: 20, soft_food: 5, infant: 3 },
				recipes: [{ recipe_id: 'recipe:01HZ', planned_qty: 50 }]
			},
			ctx
		);
		expect(plan._id).toBe('meal_plan:2026-07-15:dinner');
		expect(plan.type).toBe('meal_plan');
		expect(plan.status).toBe('draft');
		expect(plan.shelter_code).toBe('SH001');
	});

	it('two plans with same date+meal have identical _id (deterministic collision)', () => {
		const input = {
			date: '2026-07-15',
			meal: 'lunch' as const,
			headcount: { total: 80, halal: 10, soft_food: 2, infant: 1 },
			recipes: [{ recipe_id: 'recipe:abc', planned_qty: 40 }]
		};
		const a = createMealPlan(input, ctx);
		const b = createMealPlan(input, ctx);
		expect(a._id).toBe(b._id);
	});

	it('rejects invalid date format', () => {
		expect(() =>
			createMealPlan(
				{
					date: '15-07-2026',
					meal: 'breakfast',
					headcount: { total: 10, halal: 0, soft_food: 0, infant: 0 },
					recipes: [{ recipe_id: 'recipe:x', planned_qty: 5 }]
				},
				ctx
			)
		).toThrow();
	});

	it('rejects empty recipes array', () => {
		expect(() =>
			createMealPlan(
				{
					date: '2026-07-15',
					meal: 'snack',
					headcount: { total: 10, halal: 0, soft_food: 0, infant: 0 },
					recipes: []
				},
				ctx
			)
		).toThrow();
	});

	it('rejects a single sub-count exceeding total (CR-022 per-field invariant)', () => {
		expect(() =>
			createMealPlan(
				{
					date: '2026-07-15',
					meal: 'lunch',
					headcount: { total: 10, halal: 11, soft_food: 0, infant: 0 },
					recipes: [{ recipe_id: 'recipe:x', planned_qty: 5 }]
				},
				ctx
			)
		).toThrow();
	});

	it('allows overlapping sub-counts whose sum exceeds total (orthogonal dimensions)', () => {
		const plan = createMealPlan(
			{
				date: '2026-07-15',
				meal: 'lunch',
				headcount: { total: 10, halal: 8, soft_food: 5, infant: 3 },
				recipes: [{ recipe_id: 'recipe:x', planned_qty: 5 }]
			},
			ctx
		);
		expect(plan.headcount.halal).toBe(8);
	});
});

// ---- KitchenRequisition ----

describe('createKitchenRequisition', () => {
	it('embeds pre-generated ledger_ids at creation', () => {
		const ledgerIds = ['stock_ledger:AAAA', 'stock_ledger:BBBB'];
		const req = createKitchenRequisition(
			{
				meal_plan_id: 'meal_plan:2026-07-15:dinner',
				items: [
					{ item_id: 'item:rice', qty_requested: 50, qty_issued: 50, unit: 'kg' },
					{ item_id: 'item:egg', qty_requested: 200, qty_issued: 180, unit: 'ฟอง' }
				]
			},
			ledgerIds,
			ctx
		);
		expect(req.type).toBe('kitchen_requisition');
		expect(req.ledger_ids).toEqual(ledgerIds);
		expect(req._id).toMatch(/^kitchen_requisition:/);
	});

	it('allows null meal_plan_id (out-of-plan requisition)', () => {
		const req = createKitchenRequisition(
			{
				meal_plan_id: null,
				items: [{ item_id: 'item:water', qty_requested: 10, qty_issued: 10, unit: 'ขวด' }]
			},
			['stock_ledger:CCCC'],
			ctx
		);
		expect(req.meal_plan_id).toBeNull();
	});

	it('allows qty_issued = 0 (item out of stock)', () => {
		const req = createKitchenRequisition(
			{
				meal_plan_id: null,
				items: [{ item_id: 'item:oil', qty_requested: 5, qty_issued: 0, unit: 'ขวด' }]
			},
			[],
			ctx
		);
		expect(req.items[0].qty_issued).toBe(0);
		expect(req.ledger_ids).toHaveLength(0);
	});

	it('rejects qty_requested <= 0', () => {
		expect(() =>
			createKitchenRequisition(
				{
					meal_plan_id: null,
					items: [{ item_id: 'item:rice', qty_requested: 0, qty_issued: 0, unit: 'kg' }]
				},
				[],
				ctx
			)
		).toThrow();
	});

	it('rejects qty_issued > qty_requested (over-issue) outside the UI clamp', () => {
		expect(() =>
			createKitchenRequisition(
				{
					meal_plan_id: null,
					items: [{ item_id: 'item:rice', qty_requested: 10, qty_issued: 11, unit: 'kg' }]
				},
				['stock_ledger:DDDD'],
				ctx
			)
		).toThrow(/qty_issued cannot exceed qty_requested/);
	});
});

// ---- MealService ----

describe('createMealService', () => {
	it('generates deterministic _id from date + meal', () => {
		const svc = createMealService(
			{
				date: '2026-07-15',
				meal: 'dinner',
				served: 95,
				waste: 3,
				external: { volunteers: 5, outside_evacuees: 2 }
			},
			ctx
		);
		expect(svc._id).toBe('meal_service:2026-07-15:dinner');
		expect(svc.type).toBe('meal_service');
	});

	it('two records with same date+meal share the same _id', () => {
		const input = {
			date: '2026-07-15',
			meal: 'breakfast' as const,
			served: 80,
			waste: 5,
			external: { volunteers: 3, outside_evacuees: 0 }
		};
		expect(createMealService(input, ctx)._id).toBe(createMealService(input, ctx)._id);
	});
});

// ---- type guards ----

describe('type guards', () => {
	it('isMealPlan / isKitchenRequisition / isMealService identify correctly', () => {
		const plan = createMealPlan(
			{
				date: '2026-07-15',
				meal: 'lunch',
				headcount: { total: 10, halal: 0, soft_food: 0, infant: 0 },
				recipes: [{ recipe_id: 'recipe:x', planned_qty: 5 }]
			},
			ctx
		);
		expect(isMealPlan(plan)).toBe(true);
		expect(isKitchenRequisition(plan)).toBe(false);
		expect(isMealService(plan)).toBe(false);
		expect(isMealPlan(null)).toBe(false);
		expect(isMealPlan({ type: 'something_else' })).toBe(false);
	});
});
