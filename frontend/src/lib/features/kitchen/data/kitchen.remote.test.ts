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
	const lotStorage = await import('../../operations/domain/lot-storage');
	const ledgerId = await import('../../operations/domain/deterministic-ledger-id');
	return {
		createStockLedger: domain.createStockLedger,
		deriveDeterministicLedgerId: ledgerId.deriveDeterministicLedgerId,
		storageLotFields: lotStorage.storageLotFields,
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
			// Every ledger writer stamps the same version (CR-088 → 4; draft-shelter-storage-points → 5).
			expect(row.schema_v).toBe(5);
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

// Requisition (deduct stock) → service record → variance summary. Bypasses the SOP-calc plan entrypoint
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

describe('KitchenRemoteRepository — issueRequisition', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(async () => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
		await seedStock('item:rice', 100);
	});

	it('issues a confirmed plan and writes the food ledger', async () => {
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
		const requisition = await repo.issueRequisition({ meal_plan_id: plan._id, items: issued }, ctx);

		const ledger = await memoryRepo.allByType('stock_ledger', isStockLedger);
		expect(ledger.filter((d) => d.ref_id === requisition._id).length).toBeGreaterThan(0);
	});
});

// ---- 2-Tier MealSession & TKT-KITCHEN Flow 3 Tests ----

describe('KitchenRemoteRepository — MealSession CRUD', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	it('creates, lists, updates, and deletes meal_session', async () => {
		const session = await repo.createMealSession(
			{
				name: 'มื้อกลางวัน 2 ก.ย. 69',
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
		expect(session.type).toBe('meal_session');
		expect(session.status).toBe('active');

		const list = await repo.listMealSessions();
		expect(list).toHaveLength(1);
		expect(list[0]._id).toBe(session._id);

		const updated = await repo.updateMealSession(session, { notes: 'เพิ่มหมายเหตุ' });
		expect(updated.notes).toBe('เพิ่มหมายเหตุ');

		await repo.deleteMealSession(updated);
		expect(await repo.listMealSessions()).toHaveLength(0);
	});
});

describe('KitchenRemoteRepository — Requisition Workflow', () => {
	let repo: KitchenRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	it('createPendingRequisition commits meal_plan + requisition', async () => {
		const res1 = await repo.createPendingRequisition(
			{
				planInput: {
					date: '2026-09-02',
					meal: 'lunch',
					headcount: { total: 50, halal: 20, soft_food: 0, infant: 0 },
					recipes: [{ recipe_id: 'recipe:curry', planned_qty: 100 }]
				},
				requisitionInput: {
					items: [{ item_id: 'item:chicken', qty_requested: '25', unit: 'kg' }]
				}
			},
			ctx
		);

		expect(res1.plan).toBeDefined();
		expect(res1.requisition.status).toBe('pending');
		expect(res1.requisition.meal_plan_id).toBe(res1.plan?._id);

		const res2 = await repo.createPendingRequisition(
			{
				requisitionInput: {
					items: [{ item_id: 'item:rice', qty_requested: '50', unit: 'kg' }]
				}
			},
			ctx
		);
		expect(res2.requisition.status).toBe('pending');
	});

	it('approveKitchenRequisition cuts stock_ledger with reason=requisition and ref_id=requisition._id', async () => {
		await seedStock('item:pork', 100);

		const { requisition } = await repo.createPendingRequisition(
			{
				requisitionInput: {
					items: [{ item_id: 'item:pork', qty_requested: '20', unit: 'kg' }]
				}
			},
			ctx
		);

		const approved = await repo.approveKitchenRequisition(
			requisition._id,
			'warehouse_officer',
			undefined,
			ctx
		);

		expect(approved.status).toBe('approved');
		expect(approved.approved_by).toBe('warehouse_officer');
		expect(approved.ledger_ids).toHaveLength(1);

		const ledgers = await memoryRepo.allByType('stock_ledger', isStockLedger);
		const reqLedger = ledgers.find((l) => l.ref_id === requisition._id);
		expect(reqLedger).toBeDefined();
		expect(reqLedger?.qty).toBe('-20');
		expect(reqLedger?.reason).toBe('requisition');
	});

	it('approveKitchenRequisition handles partial issue (D12)', async () => {
		await seedStock('item:beef', 100);
		const { requisition } = await repo.createPendingRequisition(
			{
				requisitionInput: {
					items: [{ item_id: 'item:beef', qty_requested: '20', unit: 'kg' }]
				}
			},
			ctx
		);

		// Warehouse issues 15 instead of 20
		const approved = await repo.approveKitchenRequisition(
			requisition._id,
			'warehouse_officer',
			{ partial_items: [{ item_id: 'item:beef', qty_issued: '15' }] },
			ctx
		);

		expect(approved.items[0].qty_issued).toBe('15');

		// Verify stock ledger was cut for 15, not 20
		const ledgers = await memoryRepo.allByType('stock_ledger', isStockLedger);
		const beefLedger = ledgers.find((l) => l.ref_id === requisition._id);
		expect(beefLedger?.qty).toBe('-15');
	});

	it('rejectKitchenRequisition records rejection reason and blocks subsequent approval', async () => {
		const { requisition } = await repo.createPendingRequisition(
			{
				requisitionInput: {
					items: [{ item_id: 'item:pork', qty_requested: '30', unit: 'kg' }]
				}
			},
			ctx
		);

		const rejected = await repo.rejectKitchenRequisition(
			requisition._id,
			'วัตถุดิบขาดสต็อก ไม่สามารถจ่ายได้',
			ctx
		);
		expect(rejected.status).toBe('rejected');
		expect(rejected.reject_reason).toBe('วัตถุดิบขาดสต็อก ไม่สามารถจ่ายได้');

		// Attempting to approve rejected requisition throws
		await expect(
			repo.approveKitchenRequisition(requisition._id, 'warehouse_officer', undefined, ctx)
		).rejects.toThrow(/already rejected/);
	});
});

describe('KitchenRemoteRepository.confirmMealServiceReceiptWithYield (cooked food → stock)', () => {
	let repo: KitchenRemoteRepository;

	const resolved = (
		item_id: string,
		qty: string,
		extra: Partial<{ storage_point: { id: string; name: string }; unit: string }> = {}
	) => ({ item_id, qty, unit: 'box', item_name: `เมนู ${item_id}`, ...extra });

	async function recordService() {
		return repo.recordMealService(
			{
				date: '2026-07-15',
				meal: 'dinner' as const,
				meal_plan_id: 'meal_plan:01ARZ3NDEKTSV4RRFFQ69G5FAV',
				actual_yield: 120,
				served: 0,
				waste: 0,
				external: { volunteers: 0, outside_evacuees: 0 }
			},
			ctx
		);
	}

	const ledgerRows = async () =>
		(await memoryRepo.allByType('stock_ledger', isStockLedger)).filter(
			(r) => r.reason === 'receive'
		);

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new KitchenRemoteRepository('shelter_sh001');
	});

	it('writes one receive row per line plus a confirmed receipt', async () => {
		const service = await recordService();
		const { receipt, ledger } = await repo.confirmMealServiceReceiptWithYield(
			service,
			[
				resolved('item_master:A', '80', { storage_point: { id: 'p1', name: 'ตู้เย็น 1' } }),
				resolved('item_master:B', '40')
			],
			ctx
		);

		expect(receipt.outcome).toBe('confirmed');
		expect(receipt.meal_service_id).toBe(service._id);
		expect(ledger).toHaveLength(2);

		const rows = await ledgerRows();
		expect(rows).toHaveLength(2);
		const a = rows.find((r) => r.item_id === 'item_master:A')!;
		expect(a.qty).toBe('80');
		expect(a.unit).toBe('box');
		expect(a.ref_id).toBe(service._id);
		expect(a.lot?.note).toBe('เมนู item_master:A');
		expect(a.lot?.storage_point_id).toBe('p1');
		expect(a.lot?.storage_zone).toBe('ตู้เย็น 1');
		expect(a.lot_ref).toBe(a._id);
		expect(rows.find((r) => r.item_id === 'item_master:B')!.lot?.storage_point_id).toBeUndefined();
	});

	it('stamps lot.expiry four hours after the service was recorded', async () => {
		const service = await recordService();
		await repo.confirmMealServiceReceiptWithYield(service, [resolved('item_master:A', '120')], ctx);

		const [row] = await ledgerRows();
		const hours =
			(new Date(row.lot!.expiry!).getTime() - new Date(service.created_at).getTime()) / 3_600_000;
		expect(hours).toBe(4);
	});

	it('merges repeated lines for the same item and point into one row', async () => {
		const service = await recordService();
		await repo.confirmMealServiceReceiptWithYield(
			service,
			[resolved('item_master:A', '30'), resolved('item_master:A', '20')],
			ctx
		);

		const rows = await ledgerRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].qty).toBe('50');
	});

	it('refuses a second decision for the same meal_service', async () => {
		const service = await recordService();
		await repo.confirmMealServiceReceiptWithYield(service, [resolved('item_master:A', '10')], ctx);

		await expect(
			repo.confirmMealServiceReceiptWithYield(service, [resolved('item_master:A', '10')], ctx)
		).rejects.toThrow(/already has a receipt decision/);
		expect(await ledgerRows()).toHaveLength(1);
	});

	it('does not double-receive when a retry follows a half-finished attempt', async () => {
		const service = await recordService();
		const lines = [resolved('item_master:A', '10'), resolved('item_master:B', '5')];
		const first = await repo.confirmMealServiceReceiptWithYield(service, lines, ctx);

		// Simulate "ledger written, receipt lost": drop the receipt, keep the rows.
		await memoryRepo.remove(first.receipt);

		const retry = await repo.confirmMealServiceReceiptWithYield(service, lines, ctx);
		expect(await ledgerRows()).toHaveLength(2);
		expect(retry.ledger.map((r) => r._id).sort()).toEqual(first.ledger.map((r) => r._id).sort());
	});

	it('rejects a retry whose quantity no longer matches the row already written', async () => {
		const service = await recordService();
		const first = await repo.confirmMealServiceReceiptWithYield(
			service,
			[resolved('item_master:A', '10')],
			ctx
		);
		await memoryRepo.remove(first.receipt);

		await expect(
			repo.confirmMealServiceReceiptWithYield(service, [resolved('item_master:A', '99')], ctx)
		).rejects.toThrow(/already holds 10/);
	});

	it('requires at least one line', async () => {
		const service = await recordService();
		await expect(repo.confirmMealServiceReceiptWithYield(service, [], ctx)).rejects.toThrow(
			/at least one line/
		);
	});
});
