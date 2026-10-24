import { describe, it, expect } from 'vitest';
import {
	createMealPlan,
	createKitchenRequisition,
	createPendingRequisition,
	createMealSession,
	createMealService,
	isMealPlan,
	isKitchenRequisition,
	isMealService,
	isMealSession
} from './kitchen';
import type { MealPlan, MealService } from './kitchen';
import { expandTargetTags, computeSessionGroupProgress, type TargetGroupTag } from './meal-calc';
import { deriveSessionHeadcountFromOccupancy } from './occupancy';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'kitchen_staff' };

// ---- MealPlan ----

describe('createMealPlan', () => {
	it('generates a ulid-based _id (meal_plan:{ulid})', () => {
		const plan = createMealPlan(
			{
				date: '2026-07-15',
				meal: 'dinner',
				headcount: { total: 100, halal: 20, soft_food: 5, infant: 3 },
				recipes: [{ recipe_id: 'recipe:01HZ', planned_qty: 50 }]
			},
			ctx
		);
		expect(plan._id).toMatch(/^meal_plan:[0-9A-Z]{26}$/);
		expect(plan.type).toBe('meal_plan');
		expect(plan.status).toBe('draft');
		expect(plan.shelter_code).toBe('SH001');
	});

	it('two plans with the same date+meal get different _id (extra batches allowed)', () => {
		const input = {
			date: '2026-07-15',
			meal: 'lunch' as const,
			headcount: { total: 80, halal: 10, soft_food: 2, infant: 1 },
			recipes: [{ recipe_id: 'recipe:abc', planned_qty: 40 }]
		};
		const a = createMealPlan(input, ctx);
		const b = createMealPlan(input, ctx);
		expect(a._id).not.toBe(b._id);
		expect(a.date).toBe(b.date);
		expect(a.meal).toBe(b.meal);
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
		expect(req.items[0].qty_issued).toBe('0');
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
	it('generates a ulid _id and carries meal_plan_id through', () => {
		const svc = createMealService(
			{
				date: '2026-07-15',
				meal: 'dinner',
				meal_plan_id: 'meal_plan:01ARZ3NDEKTSV4RRFFQ69G5FAV',
				served: 95,
				waste: 3,
				external: { volunteers: 5, outside_evacuees: 2 }
			},
			'RCV-KITCHEN-0001',
			ctx
		);
		expect(svc._id).toMatch(/^meal_service:[0-9A-Z]{26}$/);
		expect(svc.type).toBe('meal_service');
		expect(svc.meal_plan_id).toBe('meal_plan:01ARZ3NDEKTSV4RRFFQ69G5FAV');
	});

	it('sets receipt_no from the minted number (CR-177)', () => {
		const svc = createMealService(
			{
				date: '2026-07-15',
				meal: 'lunch',
				served: 80,
				waste: 5,
				external: { volunteers: 0, outside_evacuees: 0 }
			},
			'RCV-KITCHEN-0007',
			ctx
		);
		expect(svc.receipt_no).toBe('RCV-KITCHEN-0007');
	});

	it('two records for the same date+meal (extra batches) get different _ids', () => {
		const input = {
			date: '2026-07-15',
			meal: 'breakfast' as const,
			served: 80,
			waste: 5,
			external: { volunteers: 3, outside_evacuees: 0 }
		};
		expect(createMealService(input, 'RCV-KITCHEN-0001', ctx)._id).not.toBe(
			createMealService(input, 'RCV-KITCHEN-0001', ctx)._id
		);
	});

	it('carries actual_yield through when provided (CR-084)', () => {
		const svc = createMealService(
			{
				date: '2026-07-15',
				meal: 'lunch',
				actual_yield: 90,
				served: 85,
				waste: 3,
				external: { volunteers: 1, outside_evacuees: 0 }
			},
			'RCV-KITCHEN-0001',
			ctx
		);
		expect(svc.actual_yield).toBe(90);
	});

	it('keeps actual_yield = 0 (explicit zero yield, not dropped as falsy)', () => {
		const svc = createMealService(
			{
				date: '2026-07-15',
				meal: 'lunch',
				actual_yield: 0,
				served: 0,
				waste: 0,
				external: { volunteers: 0, outside_evacuees: 0 }
			},
			'RCV-KITCHEN-0001',
			ctx
		);
		expect(svc.actual_yield).toBe(0);
	});

	it('omits actual_yield entirely when absent', () => {
		const svc = createMealService(
			{
				date: '2026-07-15',
				meal: 'lunch',
				served: 80,
				waste: 5,
				external: { volunteers: 0, outside_evacuees: 0 }
			},
			'RCV-KITCHEN-0001',
			ctx
		);
		expect('actual_yield' in svc).toBe(false);
	});

	it('rejects a negative actual_yield', () => {
		expect(() =>
			createMealService(
				{
					date: '2026-07-15',
					meal: 'lunch',
					actual_yield: -1,
					served: 80,
					waste: 5,
					external: { volunteers: 0, outside_evacuees: 0 }
				},
				'RCV-KITCHEN-0001',
				ctx
			)
		).toThrow();
	});

	it('rejects a fractional actual_yield (portions are whole counts)', () => {
		expect(() =>
			createMealService(
				{
					date: '2026-07-15',
					meal: 'lunch',
					actual_yield: 90.5,
					served: 80,
					waste: 5,
					external: { volunteers: 0, outside_evacuees: 0 }
				},
				'RCV-KITCHEN-0001',
				ctx
			)
		).toThrow();
	});

	it('keeps schema_v 2 — optional field, no bump (CR-084)', () => {
		const svc = createMealService(
			{
				date: '2026-07-15',
				meal: 'lunch',
				actual_yield: 90,
				served: 85,
				waste: 3,
				external: { volunteers: 0, outside_evacuees: 0 }
			},
			'RCV-KITCHEN-0001',
			ctx
		);
		expect(svc.schema_v).toBe(2);
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

// ---- MealSession & 2-Tier Production Flow ----

describe('createMealSession', () => {
	it('creates meal_session doc with 5 target groups and total', () => {
		const session = createMealSession(
			{
				name: 'มื้อเช้า 28 ส.ค. 2569',
				date: '2026-08-28',
				meal: 'breakfast',
				target_headcount: {
					halal: 20,
					infant: 5,
					soft_food: 10,
					regular: 65,
					volunteer: 8,
					total: 108
				},
				notes: 'ทดสอบมื้อเช้า'
			},
			ctx
		);
		expect(session._id).toMatch(/^meal_session:[0-9A-Z]{26}$/);
		expect(session.type).toBe('meal_session');
		expect(session.schema_v).toBe(1);
		expect(session.status).toBe('active');
		expect(session.target_headcount.total).toBe(108);
		expect(session.target_headcount.halal).toBe(20);
		expect(isMealSession(session)).toBe(true);
	});
});

describe('createPendingRequisition & Migration Guard', () => {
	it('creates pending requisition', () => {
		const req = createPendingRequisition(
			{
				meal_plan_id: 'meal_plan:01J',
				meal_session_id: 'meal_session:01J',
				items: [{ item_id: 'item:rice', qty_requested: '50', qty_issued: '0', unit: 'kg' }]
			},
			ctx
		);
		expect(req.type).toBe('kitchen_requisition');
		expect(req.schema_v).toBe(3);
		expect(req.status).toBe('pending');
		expect(req.ledger_ids).toEqual([]);
	});

	it('migration guard coerces legacy requisition without status to approved (D1)', () => {
		const legacyDoc = {
			_id: 'kitchen_requisition:01J',
			type: 'kitchen_requisition',
			schema_v: 2,
			shelter_code: 'SH001',
			meal_plan_id: 'meal_plan:01J',
			items: [{ item_id: 'item:rice', qty_requested: '10', qty_issued: '10', unit: 'kg' }],
			ledger_ids: ['stock_ledger:01J'],
			issued_at: '2026-08-01T08:00:00.000Z',
			created_at: '2026-08-01T08:00:00.000Z',
			updated_at: '2026-08-01T08:00:00.000Z',
			created_by: 'staff'
		};

		const legacy = legacyDoc as Record<string, unknown>;
		expect(isKitchenRequisition(legacyDoc)).toBe(true);
		expect(legacy.status).toBe('approved');
		expect(legacy.requested_at).toBe('2026-08-01T08:00:00.000Z');
		expect(legacy.approved_at).toBe('2026-08-01T08:00:00.000Z');
	});
});

describe('5-group progress calculation', () => {
	it('expands everyone tag to all 5 groups (D4)', () => {
		expect(expandTargetTags(['everyone'])).toEqual([
			'halal',
			'infant',
			'soft_food',
			'regular',
			'volunteer'
		]);
		expect(expandTargetTags(['halal', 'regular'])).toEqual(['halal', 'regular']);
	});

	it('allocates a multi-tag yield once across groups instead of counting it per tag', () => {
		const session = createMealSession(
			{
				name: 'มื้อกลางวัน',
				date: '2026-09-02',
				meal: 'lunch',
				target_headcount: {
					halal: 20,
					infant: 5,
					soft_food: 10,
					regular: 50,
					volunteer: 5,
					total: 90
				}
			},
			ctx
		);

		// Batch 1: halal & regular (50 portions produced)
		const plan1 = createMealPlan(
			{
				date: '2026-09-02',
				meal: 'lunch',
				headcount: { total: 50, halal: 20, soft_food: 0, infant: 0 },
				recipes: [{ recipe_id: 'recipe:chicken', planned_qty: 100 }],
				meal_session_id: session._id,
				target_tags: ['halal', 'regular'],
				allocated_target: 50
			},
			ctx
		);

		const service1 = createMealService(
			{
				date: '2026-09-02',
				meal: 'lunch',
				meal_plan_id: plan1._id,
				actual_yield: 50,
				served: 48,
				waste: 2,
				external: { volunteers: 0, outside_evacuees: 0 }
			},
			'RCV-KITCHEN-0001',
			ctx
		);

		const progress = computeSessionGroupProgress(session, [plan1], [service1]);
		expect(progress.groups.halal).toMatchObject({ received: 20, isCompleted: true });
		expect(progress.groups.regular).toMatchObject({
			received: 30,
			shortfall: 20,
			isCompleted: false
		});
		for (const tag of ['infant', 'soft_food', 'volunteer'] as const) {
			expect(progress.groups[tag]).toMatchObject({ received: 0, isCompleted: false });
		}

		expect(progress.completedCount).toBe(1);
		expect(progress.totalCount).toBe(5);
		expect(progress.summaryText).toBe('1/5 กลุ่มครบ');
		expect(progress.isAllCompleted).toBe(false);
		expect(progress.noTargetTags).toEqual([]);
		expect(progress.totalTarget).toBe(90);
		expect(progress.totalProduced).toBe(50);
		expect(progress.surplus).toBe(0);
	});

	it('derives session headcount from active occupants', () => {
		const occupants = [
			{ current_stay: { status: 'active' }, religion: 'muslim' },
			{ current_stay: { status: 'active' }, special_needs: ['infant'] },
			{ current_stay: { status: 'active' }, special_needs: ['elderly'] },
			{ current_stay: { status: 'active' } }, // regular
			{ current_stay: { status: 'checked_out' } } // inactive
		];
		const counts = deriveSessionHeadcountFromOccupancy(occupants);
		expect(counts.total).toBe(4);
		expect(counts.halal).toBe(1);
		expect(counts.infant).toBe(1);
		expect(counts.soft_food).toBe(1);
		expect(counts.regular).toBe(1);
		expect(counts.volunteer).toBe(0);
	});
});

describe('computeSessionGroupProgress — priority fill', () => {
	type Batch = { tags?: string[]; yield?: number; served?: number; noService?: boolean };

	function progressFor(targets: Partial<Record<TargetGroupTag, number>>, batches: Batch[]) {
		const target = { halal: 0, infant: 0, soft_food: 0, regular: 0, volunteer: 0, ...targets };
		const total = Object.values(target).reduce((sum, n) => sum + n, 0);
		const session = createMealSession(
			{
				name: 'มื้อทดสอบ',
				date: '2026-10-22',
				meal: 'lunch',
				target_headcount: { ...target, total }
			},
			ctx
		);
		const plans: MealPlan[] = [];
		const services: MealService[] = [];
		batches.forEach((batch, i) => {
			const plan = createMealPlan(
				{
					date: '2026-10-22',
					meal: 'lunch',
					headcount: { total: 1, halal: 0, soft_food: 0, infant: 0 },
					recipes: [{ recipe_id: 'recipe:test', planned_qty: 1 }],
					meal_session_id: session._id,
					...(batch.tags ? { target_tags: batch.tags } : {})
				},
				ctx
			);
			plans.push(plan);
			if (batch.noService) return;
			services.push(
				createMealService(
					{
						date: '2026-10-22',
						meal: 'lunch',
						meal_plan_id: plan._id,
						actual_yield: batch.yield,
						served: batch.served ?? 0,
						waste: 0,
						external: { volunteers: 0, outside_evacuees: 0 }
					},
					`RCV-KITCHEN-${String(i + 1).padStart(4, '0')}`,
					ctx
				)
			);
		});
		return computeSessionGroupProgress(session, plans, services);
	}

	const issueTargets = { halal: 47, regular: 235 };

	it('fills each tagged group once for the issue #770 example (282 plates)', () => {
		const progress = progressFor(issueTargets, [{ tags: ['halal', 'regular'], yield: 282 }]);
		expect(progress.groups.halal).toMatchObject({ received: 47, isCompleted: true });
		expect(progress.groups.regular).toMatchObject({ received: 235, isCompleted: true });
		expect(Object.values(progress.groups).some((g) => g.received === 282)).toBe(false);
		for (const tag of ['infant', 'soft_food', 'volunteer'] as const) {
			expect(progress.groups[tag]).toMatchObject({ hasTarget: false, isCompleted: false });
		}
		expect(progress.activeTags).toEqual(['halal', 'regular']);
		expect(progress.noTargetTags).toEqual(['infant', 'soft_food', 'volunteer']);
		expect(progress.summaryText).toBe('2/2 กลุ่มครบ');
		expect(progress.isAllCompleted).toBe(true);
		expect(progress).toMatchObject({ totalTarget: 282, totalProduced: 282, surplus: 0 });
	});

	it('fills the restricted group first and reports the shortfall on regular', () => {
		const progress = progressFor(issueTargets, [{ tags: ['halal', 'regular'], yield: 250 }]);
		expect(progress.groups.halal).toMatchObject({ received: 47, isCompleted: true });
		expect(progress.groups.regular).toMatchObject({
			received: 203,
			shortfall: 32,
			isCompleted: false
		});
		expect(progress.summaryText).toBe('1/2 กลุ่มครบ');
		expect(progress.totalProduced).toBe(250);
	});

	it('reports plates beyond every tagged target as surplus', () => {
		const progress = progressFor(issueTargets, [{ tags: ['halal', 'regular'], yield: 300 }]);
		expect(progress.groups.halal.received).toBe(47);
		expect(progress.groups.regular.received).toBe(235);
		expect(progress).toMatchObject({ surplus: 18, totalProduced: 300 });
	});

	it('never moves a narrow menu overflow into a group outside its tags', () => {
		const progress = progressFor({ soft_food: 10 }, [{ tags: ['soft_food'], yield: 15 }]);
		expect(progress.groups.soft_food).toMatchObject({ received: 10, isCompleted: true });
		expect(progress.groups.regular.received).toBe(0);
		expect(progress.surplus).toBe(5);
	});

	it('allocates the narrowest-tagged menu first regardless of input order', () => {
		const progress = progressFor({ soft_food: 10, regular: 10 }, [
			{ tags: ['everyone'], yield: 10 },
			{ tags: ['soft_food'], yield: 10 }
		]);
		expect(progress.groups.soft_food.received).toBe(10);
		expect(progress.groups.regular.received).toBe(10);
		expect(progress.surplus).toBe(0);
		expect(progress.summaryText).toBe('2/2 กลุ่มครบ');
	});

	it('adds up menus that share the same tags without double counting', () => {
		const progress = progressFor({ halal: 30, regular: 30 }, [
			{ tags: ['halal', 'regular'], yield: 20 },
			{ tags: ['halal', 'regular'], yield: 20 }
		]);
		expect(progress.groups.halal).toMatchObject({ received: 30, isCompleted: true });
		expect(progress.groups.regular).toMatchObject({ received: 10, shortfall: 20 });
	});

	it('fills an everyone menu in priority order: infant, soft food, halal, volunteer, regular', () => {
		const progress = progressFor({ infant: 5, soft_food: 5, halal: 5, volunteer: 5, regular: 5 }, [
			{ tags: ['everyone'], yield: 22 }
		]);
		expect(progress.groups.infant.received).toBe(5);
		expect(progress.groups.soft_food.received).toBe(5);
		expect(progress.groups.halal.received).toBe(5);
		expect(progress.groups.volunteer.received).toBe(5);
		expect(progress.groups.regular).toMatchObject({ received: 2, shortfall: 3 });
	});

	it('shows no target instead of 0/0 when every group target is zero', () => {
		const progress = progressFor({}, [{ tags: ['regular'], yield: 10 }]);
		expect(progress.totalCount).toBe(0);
		expect(progress.isAllCompleted).toBe(false);
		expect(progress.summaryText).toBe('ไม่มีเป้าหมาย');
		expect(progress.noTargetTags).toHaveLength(5);
		expect(progress.surplus).toBe(10);
	});

	it('treats a menu without target tags as regular', () => {
		const progress = progressFor({ regular: 10 }, [{ yield: 10 }]);
		expect(progress.groups.regular).toMatchObject({ received: 10, isCompleted: true });
	});

	it('ignores menus with no service or a zero yield', () => {
		const progress = progressFor({ regular: 10 }, [
			{ tags: ['regular'], noService: true },
			{ tags: ['regular'], yield: 0 }
		]);
		expect(progress.groups.regular).toMatchObject({ received: 0, shortfall: 10 });
		expect(progress.totalProduced).toBe(0);
	});

	it('falls back to served when actual_yield is not recorded', () => {
		const progress = progressFor({ regular: 10 }, [{ tags: ['regular'], served: 8 }]);
		expect(progress.groups.regular).toMatchObject({ received: 8, shortfall: 2 });
	});
});
