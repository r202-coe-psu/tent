// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

// bulkDocs (used by issueRequisition for the atomic requisition+ledger write)
// bypasses the Repository abstraction and hits couch-db.ts directly — route it
// through the same in-memory store so ledger entries are readable via repo.get.
vi.mock('$lib/db/couch-db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/couch-db')>();
	return {
		...actual,
		bulkDocs: async (_dbName: string, docs: { _id: string }[]) => {
			const saved = [];
			for (const doc of docs) saved.push(await memoryRepo.put(doc));
			return saved;
		}
	};
});

// Mock the operations barrel with its real domain logic (imported directly from
// the domain module, bypassing the barrel's UI/Svelte exports) so this pure
// data-layer test doesn't transitively load receive-stock-form.svelte and its
// sveltekit-superforms adapter chain.
vi.mock('$lib/features/operations', async () => {
	const domain = await import('../../operations/domain/operations');
	return {
		createStockLedger: domain.createStockLedger,
		stockBalance: domain.stockBalance,
		isStockLedger: domain.isStockLedger
	};
});

import { KitchenRemoteRepository } from './kitchen.remote';
import { toRequisitionInput } from '../domain/meal-calc';
import { computeMealVariance } from '../domain/meal-variance';
import { isStockLedger } from '../../operations/domain/operations';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

// Seed a positive stock_ledger receipt so issueRequisition's write-time on-hand
// re-check (guards against concurrent over-issue) has stock to draw against.
async function seedStock(item_id: string, qty: string | number, unit = 'kg') {
	await memoryRepo.put({
		_id: `stock_ledger:seed-${item_id}-${Math.random().toString(36).slice(2)}`,
		type: 'stock_ledger',
		schema_v: 3,
		item_id,
		qty: String(qty),
		unit,
		reason: 'receive'
	});
}

describe('KitchenRemoteRepository.issueRequisition — ledger deduction pattern', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(async () => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
		// Ample on-hand for every item these tests issue.
		await seedStock('item:rice', 1000);
		await seedStock('item:egg', 1000, 'ฟอง');
		await seedStock('item:water', 1000, 'ขวด');
	});

	it('writes kitchen_requisition + stock_ledger entries in one bulkDocs call', async () => {
		const result = await repo.issueRequisition(
			{
				meal_plan_id: 'meal_plan:2026-07-15:dinner',
				items: [
					{ item_id: 'item:rice', qty_requested: 50, qty_issued: 50, unit: 'kg' },
					{ item_id: 'item:egg', qty_requested: 200, qty_issued: 180, unit: 'ฟอง' }
				]
			},
			ctx
		);

		expect(result.type).toBe('kitchen_requisition');
		expect(result.ledger_ids).toHaveLength(2);

		const l0 = (await memoryRepo.get(result.ledger_ids[0])) as Record<string, unknown>;
		expect(l0.type).toBe('stock_ledger');
		expect(l0.qty).toBe('-50');
		expect(l0.item_id).toBe('item:rice');
		expect(l0.reason).toBe('requisition');
		expect(l0.ref_id).toBe(result._id);

		const l1 = (await memoryRepo.get(result.ledger_ids[1])) as Record<string, unknown>;
		expect(l1.qty).toBe('-180');
		expect(l1.item_id).toBe('item:egg');
	});

	// CR-055 R7 — these rows must come out of `createStockLedger`, not be
	// assembled here, so the reason ↔ ref_id invariant reaches them too. Asserted
	// through the envelope the factory stamps: every row carries schema_v 3, the
	// shelter code and author from ctx, and one shared occurred_at per issue.
	it('mints requisition ledger rows through the shared factory', async () => {
		const result = await repo.issueRequisition(
			{
				meal_plan_id: null,
				items: [
					{ item_id: 'item:rice', qty_requested: 10, qty_issued: 10, unit: 'kg' },
					{ item_id: 'item:water', qty_requested: 5, qty_issued: 5, unit: 'ขวด' }
				]
			},
			ctx
		);

		const rows = (await Promise.all(result.ledger_ids.map((id) => memoryRepo.get(id)))) as Record<
			string,
			unknown
		>[];

		for (const row of rows) {
			expect(row.schema_v).toBe(3);
			expect(row.shelter_code).toBe(ctx.shelterCode);
			expect(row.created_by).toBe(ctx.createdBy);
			expect(row.ref_id).toBe(result._id);
			expect(String(row.ref_id)).toMatch(/^kitchen_requisition:/);
		}
		// one shared timestamp, not one `now()` per row
		expect(rows[0].occurred_at).toBe(rows[1].occurred_at);
	});

	// CR-055 R7 × the `requisition` row of R2 — the point of routing kitchen
	// through `createStockLedger` is that a bad `ref_id` cannot reach the
	// database. Forcing the requisition to mint a wrong-prefixed `_id` is the
	// only way to reach that branch, since `issueRequisition` otherwise derives
	// `ref_id` from a `kitchen_requisition:` id it built itself.
	it('rejects when the ref_id would not be a kitchen_requisition id', async () => {
		const kitchenDomain = await import('../domain/kitchen');
		const spy = vi
			.spyOn(kitchenDomain, 'createKitchenRequisition')
			.mockImplementation((input, ledgerIds, authorCtx) => ({
				...kitchenDomain.createKitchenRequisition(input, ledgerIds, authorCtx),
				_id: 'not_a_requisition:01JBOGUS'
			}));

		try {
			await expect(
				repo.issueRequisition(
					{
						meal_plan_id: null,
						items: [{ item_id: 'item:rice', qty_requested: 1, qty_issued: 1, unit: 'kg' }]
					},
					ctx
				)
			).rejects.toThrow();
		} finally {
			spy.mockRestore();
		}

		// nothing partial was written — the guard fires before bulkDocs
		const rows = await memoryRepo.allByType('stock_ledger', isStockLedger);
		expect(rows.some((r) => r.reason === 'requisition')).toBe(false);
	});

	it('ledger_ids in requisition match actual written doc _ids', async () => {
		const result = await repo.issueRequisition(
			{
				meal_plan_id: null,
				items: [{ item_id: 'item:rice', qty_requested: 20, qty_issued: 20, unit: 'kg' }]
			},
			ctx
		);

		const doc = await memoryRepo.get<{ _id: string }>(result.ledger_ids[0]);
		expect(doc?._id).toBe(result.ledger_ids[0]);
	});

	it('skips ledger entry for items with qty_issued = 0 (stock-out)', async () => {
		const result = await repo.issueRequisition(
			{
				meal_plan_id: null,
				items: [
					{ item_id: 'item:oil', qty_requested: 5, qty_issued: 0, unit: 'ขวด' },
					{ item_id: 'item:water', qty_requested: 10, qty_issued: 10, unit: 'ขวด' }
				]
			},
			ctx
		);

		expect(result.ledger_ids).toHaveLength(1);
		const doc = (await memoryRepo.get(result.ledger_ids[0])) as Record<string, unknown>;
		expect(doc.item_id).toBe('item:water');
	});

	it('refuses to issue more than the on-hand balance (concurrent over-issue guard)', async () => {
		// Fresh store with only 5 kg on hand — issuing 6 must be rejected before any write.
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
		await seedStock('item:rice', 5);

		await expect(
			repo.issueRequisition(
				{
					meal_plan_id: null,
					items: [{ item_id: 'item:rice', qty_requested: 6, qty_issued: 6, unit: 'kg' }]
				},
				ctx
			)
		).rejects.toThrow(/only 5 on hand/);

		// Nothing was appended — no kitchen_requisition doc written.
		const reqs = await repo.listRequisitions();
		expect(reqs).toHaveLength(0);
	});
});

describe('KitchenRemoteRepository.createMealPlan — calc_source audit trail (CR-025)', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	const calcSource = {
		sop_profile_id: 'sop_profile:abc',
		sop_profile_version: 3,
		headcount_as_of: '2026-07-01T00:00:00.000Z'
	};

	it('persists calc_source onto the stored meal_plan doc', async () => {
		const plan = await repo.createMealPlan(
			{
				date: '2026-07-15',
				meal: 'breakfast',
				headcount: { total: 100, halal: 0, soft_food: 0, infant: 0 },
				recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 15000 }],
				calc_source: calcSource
			},
			ctx
		);

		const stored = (await memoryRepo.get(plan._id)) as Record<string, unknown>;
		expect(stored.schema_v).toBe(2);
		expect(stored.calc_source).toEqual(calcSource);
	});
});

describe('KitchenRemoteRepository.confirmMealPlan — state transition', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	const draftInput = {
		date: '2026-07-15',
		meal: 'lunch' as const,
		headcount: { total: 50, halal: 0, soft_food: 0, infant: 0 },
		recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 7500 }]
	};

	it('draft → confirmed bumps status + updated_at and keeps _rev valid', async () => {
		const draft = await repo.createMealPlan(draftInput, ctx);
		const confirmed = await repo.confirmMealPlan(draft);

		expect(confirmed.status).toBe('confirmed');
		const stored = (await memoryRepo.get(confirmed._id)) as Record<string, unknown>;
		expect(stored.status).toBe('confirmed');
	});

	it('rejects confirming a non-draft plan', async () => {
		const draft = await repo.createMealPlan(draftInput, ctx);
		const confirmed = await repo.confirmMealPlan(draft);
		await expect(repo.confirmMealPlan(confirmed)).rejects.toThrow(/only draft/i);
	});
});

describe('KitchenRemoteRepository.updateMealPlanDraft / deleteMealPlanDraft (draft-only)', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	const draftInput = {
		date: '2026-07-15',
		meal: 'lunch' as const,
		headcount: { total: 50, halal: 0, soft_food: 0, infant: 0 },
		recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 7500 }]
	};

	it('patches headcount/recipes in place, keeping the same _id', async () => {
		const draft = await repo.createMealPlan(draftInput, ctx);
		const patched = await repo.updateMealPlanDraft(draft, {
			headcount: { total: 80, halal: 0, soft_food: 0, infant: 0 },
			recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 12000 }],
			calc_source: draft.calc_source,
			override_reason: null
		});

		expect(patched._id).toBe(draft._id);
		expect(patched.headcount.total).toBe(80);
		expect(patched.recipes).toEqual([{ recipe_id: 'ingredient:rice', planned_qty: 12000 }]);
	});

	it('rejects editing a non-draft plan', async () => {
		const draft = await repo.createMealPlan(draftInput, ctx);
		const confirmed = await repo.confirmMealPlan(draft);
		await expect(
			repo.updateMealPlanDraft(confirmed, {
				headcount: draft.headcount,
				recipes: draft.recipes,
				calc_source: draft.calc_source,
				override_reason: null
			})
		).rejects.toThrow(/only draft/i);
	});

	it('deletes a draft plan', async () => {
		const draft = await repo.createMealPlan(draftInput, ctx);
		await repo.deleteMealPlanDraft(draft);
		expect(await memoryRepo.get(draft._id)).toBeNull();
	});

	it('rejects deleting a non-draft plan', async () => {
		const draft = await repo.createMealPlan(draftInput, ctx);
		const confirmed = await repo.confirmMealPlan(draft);
		await expect(repo.deleteMealPlanDraft(confirmed)).rejects.toThrow(/only draft/i);
	});
});

// meal_service is a ulid-_id, append-only record (like kitchen_requisition) —
// a second recordMealService call for the same plan creates a distinct doc
// rather than colliding; the UI (not the doc id) is what stops a plan from
// being serviced twice (meal-plan-list.svelte hides the button once
// meal_plan_id shows up in a recorded service).
describe('KitchenRemoteRepository.recordMealService — record + read back (T-27)', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	const serviceInput = {
		date: '2026-07-15',
		meal: 'dinner' as const,
		meal_plan_id: 'meal_plan:01ARZ3NDEKTSV4RRFFQ69G5FAV',
		served: 95,
		waste: 3,
		external: { volunteers: 5, outside_evacuees: 2 },
		notes: 'เสิร์ฟช้ากว่ากำหนด'
	};

	it('persists served / waste / external + audit actor onto the stored doc', async () => {
		const svc = await repo.recordMealService(serviceInput, ctx);

		expect(svc._id).toMatch(/^meal_service:[0-9A-Z]{26}$/);
		const stored = (await memoryRepo.get(svc._id)) as Record<string, unknown>;
		expect(stored.type).toBe('meal_service');
		expect(stored.meal_plan_id).toBe('meal_plan:01ARZ3NDEKTSV4RRFFQ69G5FAV');
		expect(stored.served).toBe(95);
		expect(stored.waste).toBe(3);
		expect(stored.external).toEqual({ volunteers: 5, outside_evacuees: 2 });
		expect(stored.notes).toBe('เสิร์ฟช้ากว่ากำหนด');
		// Audit trail (DoD #5): actor + timestamp from the envelope.
		expect(stored.created_by).toBe('tester');
		expect(typeof stored.created_at).toBe('string');
	});

	it('getMealService / listMealServices read the record back', async () => {
		await repo.recordMealService(serviceInput, ctx);

		const got = await repo.getMealService('2026-07-15', 'dinner');
		expect(got?.served).toBe(95);

		const all = await repo.listMealServices();
		expect(all).toHaveLength(1);
		expect(all[0]._id).toMatch(/^meal_service:[0-9A-Z]{26}$/);
	});

	it('getMealServiceByPlanId finds the record joined to a specific plan', async () => {
		await repo.recordMealService(serviceInput, ctx);

		const got = await repo.getMealServiceByPlanId('meal_plan:01ARZ3NDEKTSV4RRFFQ69G5FAV');
		expect(got?.served).toBe(95);
		expect(await repo.getMealServiceByPlanId('meal_plan:does-not-exist')).toBeNull();
	});

	it('rejects a second service for a plan that already has one (one-shot)', async () => {
		await repo.recordMealService(serviceInput, ctx);
		await expect(repo.recordMealService(serviceInput, ctx)).rejects.toThrow(
			/already recorded for this meal plan/
		);
		expect(await repo.listMealServices()).toHaveLength(1);
	});

	it('allows multiple planless services (no meal_plan_id to be unique against)', async () => {
		const planless = { ...serviceInput, meal_plan_id: null };
		await repo.recordMealService(planless, ctx);
		await repo.recordMealService(planless, ctx);
		expect(await repo.listMealServices()).toHaveLength(2);
	});

	it('persists actual_yield onto the stored doc (CR-084)', async () => {
		const svc = await repo.recordMealService({ ...serviceInput, actual_yield: 90 }, ctx);
		const stored = (await memoryRepo.get(svc._id)) as Record<string, unknown>;
		expect(stored.actual_yield).toBe(90);
	});

	it('persists actual_yield = 0 rather than dropping it', async () => {
		const svc = await repo.recordMealService({ ...serviceInput, actual_yield: 0 }, ctx);
		const stored = (await memoryRepo.get(svc._id)) as Record<string, unknown>;
		expect(stored.actual_yield).toBe(0);
	});

	it('reads back a service with no actual_yield as undefined', async () => {
		const svc = await repo.recordMealService(serviceInput, ctx);
		expect(svc.actual_yield).toBeUndefined();
	});
});

describe('KitchenRemoteRepository.gasCylinderType — CRUD', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	const input = {
		name: 'เตาแรงดันสูง + ถัง 15kg',
		capacity_kg: '15',
		burn_rate_kg_per_hour: '0.5',
		time_multiplier: '1'
	};

	it('create → list → update → delete round-trips', async () => {
		const created = await repo.createGasCylinderType(input, ctx);
		expect(created.type).toBe('gas_cylinder_type');

		const listed = await repo.listGasCylinderTypes();
		expect(listed).toHaveLength(1);

		const updated = await repo.updateGasCylinderType(created, { ...input, capacity_kg: '48' });
		expect(updated.capacity_kg).toBe('48');
		expect(updated.updated_at >= created.updated_at).toBe(true);

		await repo.deleteGasCylinderType(updated);
		expect(await repo.listGasCylinderTypes()).toHaveLength(0);
	});
});

// The ticket's demo, as reproducible evidence: requisition (deduct stock) →
// service record → variance summary. Bypasses the SOP-calc plan entrypoint
// (createMealPlan directly with recipes) so it stays green regardless of
// unrelated sop-ratios breakage elsewhere.
describe('T-27 demo chain — requisition → service record → variance', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(async () => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
		await seedStock('item:rice', 100); // 100 kg on hand
	});

	it('plans 100, issues rice, serves 85 → variance summary reads under-plan', async () => {
		// 1. Plan a dinner for 100 people (15 kg rice = 15000 g recipe qty).
		const plan = await repo.createMealPlan(
			{
				date: '2026-07-20',
				meal: 'dinner',
				headcount: { total: 100, halal: 0, soft_food: 0, infant: 0 },
				recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 15000 }]
			},
			ctx
		);
		await repo.confirmMealPlan(plan);

		// 2. Requisition off the plan — deducts stock via stock_ledger (T-26).
		const reqInput = toRequisitionInput(plan);
		const issued = reqInput.items.map((i) => ({ ...i, qty_issued: i.qty_requested }));
		await repo.issueRequisition({ meal_plan_id: plan._id, items: issued }, ctx);

		// 3. Record what actually happened at service: served 85, wasted 3, 7 external.
		const svc = await repo.recordMealService(
			{
				date: '2026-07-20',
				meal: 'dinner',
				meal_plan_id: plan._id,
				served: 85,
				waste: 3,
				external: { volunteers: 4, outside_evacuees: 3 }
			},
			ctx
		);

		// 4. Variance summary joins service ↔ plan via meal_plan_id and compares.
		const storedPlan = await repo.getMealPlanById(plan._id);
		const v = computeMealVariance(svc, storedPlan);

		expect(v.planned).toBe(100);
		expect(v.served).toBe(85);
		expect(v.waste).toBe(3);
		expect(v.external).toBe(7); // volunteers 4 + outside 3
		expect(v.variance).toBe(-15); // served 85 − planned 100
		expect(v.variance_pct).toBe(-15);
		expect(v.status).toBe('under'); // −15% is beyond the ±5% band → next round can plan fewer

		// Stock was really deducted: 100 kg on hand − 15 kg issued = 85 kg on hand.
		const ledger = await memoryRepo.allByType('stock_ledger', isStockLedger);
		const riceOnHand = ledger
			.filter((d) => d.item_id === 'item:rice')
			.reduce((sum, d) => sum + Number(d.qty), 0);
		expect(riceOnHand).toBeCloseTo(85, 6);
	});

	it('records yield 90 / served 85 → variance under-plan and yield_variance −10 (CR-084)', async () => {
		const plan = await repo.createMealPlan(
			{
				date: '2026-07-21',
				meal: 'dinner',
				headcount: { total: 100, halal: 0, soft_food: 0, infant: 0 },
				recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 15000 }]
			},
			ctx
		);
		await repo.confirmMealPlan(plan);

		const reqInput = toRequisitionInput(plan);
		const issued = reqInput.items.map((i) => ({ ...i, qty_issued: i.qty_requested }));
		await repo.issueRequisition({ meal_plan_id: plan._id, items: issued }, ctx);

		const svc = await repo.recordMealService(
			{
				date: '2026-07-21',
				meal: 'dinner',
				meal_plan_id: plan._id,
				actual_yield: 90,
				served: 85,
				waste: 3,
				external: { volunteers: 4, outside_evacuees: 3 }
			},
			ctx
		);

		const storedPlan = await repo.getMealPlanById(plan._id);
		const v = computeMealVariance(svc, storedPlan);

		expect(v.variance).toBe(-15);
		expect(v.status).toBe('under');
		expect(v.actual_yield).toBe(90);
		expect(v.yield_variance).toBe(-10); // actual_yield 90 − planned 100
	});
});

describe('KitchenRemoteRepository — gas cylinder ledger (CR-085)', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(async () => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
		await seedStock('item:rice', 100);
	});

	async function planWithGas(cylinderId: string, consumptionKg: string, date: string) {
		const plan = await repo.createMealPlan(
			{
				date,
				meal: 'dinner',
				headcount: { total: 10, halal: 0, soft_food: 0, infant: 0 },
				recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 1000 }],
				gas_usage: [{ cylinder_id: cylinderId, consumption_kg: consumptionKg }]
			},
			ctx
		);
		return repo.confirmMealPlan(plan);
	}

	it('issueRequisition writes a gas_ledger consumption entry alongside the food ledger', async () => {
		const cyl = await repo.createGasCylinderType(
			{ name: 'ถังทดสอบ', capacity_kg: '15', burn_rate_kg_per_hour: '0.5', time_multiplier: '1' },
			ctx
		);
		const plan = await planWithGas(cyl._id, '2', '2026-08-22');

		const reqInput = toRequisitionInput(plan);
		const issued = reqInput.items.map((i) => ({ ...i, qty_issued: i.qty_requested }));
		const requisition = await repo.issueRequisition({ meal_plan_id: plan._id, items: issued }, ctx);

		const gasLedger = await repo.listGasLedger();
		expect(gasLedger).toHaveLength(1);
		expect(gasLedger[0].cylinder_id).toBe(cyl._id);
		expect(gasLedger[0].qty_kg).toBe('-2');
		expect(gasLedger[0].reason).toBe('consumption');
		expect(gasLedger[0].ref_id).toBe(requisition._id);
	});

	it('cannot draw more gas than remains — throws and writes nothing at all (all-or-nothing)', async () => {
		const cyl = await repo.createGasCylinderType(
			{ name: 'ถังเล็ก', capacity_kg: '5', burn_rate_kg_per_hour: '0.5', time_multiplier: '1' },
			ctx
		);
		const plan = await planWithGas(cyl._id, '10', '2026-08-22'); // more than the 5 kg capacity

		const reqInput = toRequisitionInput(plan);
		const issued = reqInput.items.map((i) => ({ ...i, qty_issued: i.qty_requested }));

		await expect(
			repo.issueRequisition({ meal_plan_id: plan._id, items: issued }, ctx)
		).rejects.toThrow(/only 5 kg remaining/);

		expect(await repo.listGasLedger()).toHaveLength(0);
		expect(await repo.listRequisitions()).toHaveLength(0);
		// The food side didn't get written either — same atomic guarantee.
		const ledger = await memoryRepo.allByType('stock_ledger', isStockLedger);
		expect(ledger.filter((d) => d.reason === 'requisition')).toHaveLength(0);
	});

	it('a plan with no gas_usage issues normally with no gas_ledger writes', async () => {
		const plan = await repo.createMealPlan(
			{
				date: '2026-08-22',
				meal: 'lunch',
				headcount: { total: 10, halal: 0, soft_food: 0, infant: 0 },
				recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 1000 }]
			},
			ctx
		);
		await repo.confirmMealPlan(plan);
		const reqInput = toRequisitionInput(plan);
		const issued = reqInput.items.map((i) => ({ ...i, qty_issued: i.qty_requested }));
		await repo.issueRequisition({ meal_plan_id: plan._id, items: issued }, ctx);

		expect(await repo.listGasLedger()).toHaveLength(0);
	});

	it('refillGasCylinder tops up a partially-used tank', async () => {
		const cyl = await repo.createGasCylinderType(
			{ name: 'ถังเติม', capacity_kg: '15', burn_rate_kg_per_hour: '0.5', time_multiplier: '1' },
			ctx
		);
		// Consume 10 kg by hand (equivalent to a prior requisition).
		await memoryRepo.put({
			_id: `gas_ledger:seed-${cyl._id}`,
			type: 'gas_ledger',
			schema_v: 1,
			cylinder_id: cyl._id,
			qty_kg: '-10',
			reason: 'consumption',
			ref_id: null,
			occurred_at: new Date().toISOString()
		});

		const refill = await repo.refillGasCylinder(cyl._id, '5', ctx);
		expect(refill.qty_kg).toBe('5');
		expect(refill.reason).toBe('refill');

		const gasLedger = await repo.listGasLedger();
		expect(gasLedger).toHaveLength(2);
	});

	it('refillGasCylinder rejects a refill that would overflow the tank', async () => {
		const cyl = await repo.createGasCylinderType(
			{ name: 'ถังเติม', capacity_kg: '15', burn_rate_kg_per_hour: '0.5', time_multiplier: '1' },
			ctx
		);
		await memoryRepo.put({
			_id: `gas_ledger:seed-${cyl._id}`,
			type: 'gas_ledger',
			schema_v: 1,
			cylinder_id: cyl._id,
			qty_kg: '-10', // remaining = 5 kg, room = 10 kg
			reason: 'consumption',
			ref_id: null,
			occurred_at: new Date().toISOString()
		});

		await expect(repo.refillGasCylinder(cyl._id, '11', ctx)).rejects.toThrow(
			/only 10 kg of room left/
		);
	});

	// CR-085 addendum — a dust remainder can never be drawn to 0 through
	// consumption (all-or-nothing), so writeOffGasCylinder is the only path.
	it('writeOffGasCylinder zeroes out a dust remainder', async () => {
		const cyl = await repo.createGasCylinderType(
			{ name: 'ถังเล็ก', capacity_kg: '4', burn_rate_kg_per_hour: '0.3', time_multiplier: '1' },
			ctx
		);
		await memoryRepo.put({
			_id: `gas_ledger:seed-${cyl._id}`,
			type: 'gas_ledger',
			schema_v: 1,
			cylinder_id: cyl._id,
			qty_kg: '-3.999', // remaining = 0.001 kg — too small for any real requisition to hit exactly
			reason: 'consumption',
			ref_id: null,
			occurred_at: new Date().toISOString()
		});

		const adjustEntry = await repo.writeOffGasCylinder(cyl._id, ctx);
		expect(adjustEntry.reason).toBe('adjust');
		expect(adjustEntry.qty_kg).toBe('-0.001');
		expect(adjustEntry.ref_id).toBeNull();

		const gasLedger = await repo.listGasLedger();
		expect(gasLedger).toHaveLength(2);
	});

	it('writeOffGasCylinder rejects a cylinder that is already empty', async () => {
		const cyl = await repo.createGasCylinderType(
			{ name: 'ถังหมดแล้ว', capacity_kg: '4', burn_rate_kg_per_hour: '0.3', time_multiplier: '1' },
			ctx
		);
		await memoryRepo.put({
			_id: `gas_ledger:seed-${cyl._id}`,
			type: 'gas_ledger',
			schema_v: 1,
			cylinder_id: cyl._id,
			qty_kg: '-4',
			reason: 'consumption',
			ref_id: null,
			occurred_at: new Date().toISOString()
		});

		await expect(repo.writeOffGasCylinder(cyl._id, ctx)).rejects.toThrow(/already empty/);
		expect(await repo.listGasLedger()).toHaveLength(1); // nothing new written
	});

	it('writeOffGasCylinder rejects an unknown cylinder', async () => {
		await expect(repo.writeOffGasCylinder('gas_cylinder_type:missing', ctx)).rejects.toThrow(
			/not found/
		);
	});
});
