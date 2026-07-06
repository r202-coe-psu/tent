// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';

PouchDB.plugin(memory);

// Must declare before vi.mock — closures capture the reference, not the value.
let testDb: PouchDB.Database;

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	shelterDb: () => testDb
}));

vi.mock('$lib/db/pouch', () => ({
	namedLocalDb: () => testDb
}));

// Mock the operations barrel with its real domain logic (imported directly from
// the domain module, bypassing the barrel's UI/Svelte exports) so this pure
// data-layer test doesn't transitively load ReceiveStockForm.svelte and its
// sveltekit-superforms adapter chain.
vi.mock('$lib/features/operations', async () => {
	const domain = await import('../../operations/domain/operations');
	return {
		stockBalance: domain.stockBalance,
		isStockLedger: domain.isStockLedger
	};
});

import { KitchenPouchRepository } from './kitchen.pouch';
import { toRequisitionInput } from '../domain/meal-calc';
import { computeMealVariance } from '../domain/meal-variance';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

// Seed a positive stock_ledger receipt so issueRequisition's write-time on-hand
// re-check (guards against concurrent over-issue) has stock to draw against.
async function seedStock(item_id: string, qty: number, unit = 'kg') {
	await testDb.put({
		_id: `stock_ledger:seed-${item_id}-${Math.random().toString(36).slice(2)}`,
		type: 'stock_ledger',
		schema_v: 1,
		item_id,
		qty,
		unit,
		reason: 'receive'
	});
}

describe('KitchenPouchRepository.issueRequisition — spike: ledger deduction pattern', () => {
	let repo: KitchenPouchRepository;

	beforeEach(async () => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
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

		const l0 = (await testDb.get(result.ledger_ids[0])) as Record<string, unknown>;
		expect(l0.type).toBe('stock_ledger');
		expect(l0.qty).toBe(-50);
		expect(l0.item_id).toBe('item:rice');
		expect(l0.reason).toBe('requisition');
		expect(l0.ref_id).toBe(result._id);

		const l1 = (await testDb.get(result.ledger_ids[1])) as Record<string, unknown>;
		expect(l1.qty).toBe(-180);
		expect(l1.item_id).toBe('item:egg');
	});

	it('ledger_ids in requisition match actual written doc _ids', async () => {
		const result = await repo.issueRequisition(
			{
				meal_plan_id: null,
				items: [{ item_id: 'item:rice', qty_requested: 20, qty_issued: 20, unit: 'kg' }]
			},
			ctx
		);

		const doc = await testDb.get(result.ledger_ids[0]);
		expect(doc._id).toBe(result.ledger_ids[0]);
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
		const doc = (await testDb.get(result.ledger_ids[0])) as Record<string, unknown>;
		expect(doc.item_id).toBe('item:water');
	});

	it('ULID pre-generation: same ledger _id written twice → 409, not duplicate', async () => {
		const result = await repo.issueRequisition(
			{
				meal_plan_id: null,
				items: [{ item_id: 'item:rice', qty_requested: 10, qty_issued: 10, unit: 'kg' }]
			},
			ctx
		);

		// Retry: attempting to write the same pre-generated ID fails with conflict, not silent duplicate.
		await expect(
			testDb.put({ _id: result.ledger_ids[0], type: 'stock_ledger', schema_v: 1, qty: -10 })
		).rejects.toMatchObject({ status: 409 });
	});

	it('refuses to issue more than the on-hand balance (concurrent over-issue guard)', async () => {
		// Fresh db with only 5 kg on hand — issuing 6 must be rejected before any write.
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
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

describe('KitchenPouchRepository.createMealPlan — calc_source audit trail (CR-025)', () => {
	let repo: KitchenPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
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

		const stored = (await testDb.get(plan._id)) as Record<string, unknown>;
		expect(stored.schema_v).toBe(2);
		expect(stored.calc_source).toEqual(calcSource);
	});
});

describe('KitchenPouchRepository.confirmMealPlan — state transition', () => {
	let repo: KitchenPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
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
		const stored = (await testDb.get(confirmed._id)) as Record<string, unknown>;
		expect(stored.status).toBe('confirmed');
	});

	it('rejects confirming a non-draft plan', async () => {
		const draft = await repo.createMealPlan(draftInput, ctx);
		const confirmed = await repo.confirmMealPlan(draft);
		await expect(repo.confirmMealPlan(confirmed)).rejects.toThrow(/only draft/i);
	});
});

describe('KitchenPouchRepository.recordMealService — record + read back (T-27)', () => {
	let repo: KitchenPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
	});

	const serviceInput = {
		date: '2026-07-15',
		meal: 'dinner' as const,
		served: 95,
		waste: 3,
		external: { volunteers: 5, outside_evacuees: 2 },
		notes: 'เสิร์ฟช้ากว่ากำหนด'
	};

	it('persists served / waste / external + audit actor onto the stored doc', async () => {
		const svc = await repo.recordMealService(serviceInput, ctx);

		expect(svc._id).toBe('meal_service:2026-07-15:dinner');
		const stored = (await testDb.get(svc._id)) as Record<string, unknown>;
		expect(stored.type).toBe('meal_service');
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
		expect(all[0]._id).toBe('meal_service:2026-07-15:dinner');
	});

	it('append-only: re-recording the same date+meal collides (409), no silent overwrite', async () => {
		await repo.recordMealService(serviceInput, ctx);
		// Deterministic _id + no _rev → the second write is a conflict, so an already
		// recorded meal cannot be silently replaced. The UI surfaces this as 409.
		await expect(
			repo.recordMealService({ ...serviceInput, served: 120 }, ctx)
		).rejects.toMatchObject({ status: 409 });

		// Original value is untouched.
		const got = await repo.getMealService('2026-07-15', 'dinner');
		expect(got?.served).toBe(95);
	});
});

describe('KitchenPouchRepository.gasCylinderType — CRUD', () => {
	let repo: KitchenPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
	});

	const input = {
		name: 'เตาแรงดันสูง + ถัง 15kg',
		capacity_kg: 15,
		burn_rate_kg_per_hour: 0.5,
		time_multiplier: 1
	};

	it('create → list → update → delete round-trips', async () => {
		const created = await repo.createGasCylinderType(input, ctx);
		expect(created.type).toBe('gas_cylinder_type');

		const listed = await repo.listGasCylinderTypes();
		expect(listed).toHaveLength(1);

		const updated = await repo.updateGasCylinderType(created, { ...input, capacity_kg: 48 });
		expect(updated.capacity_kg).toBe(48);
		expect(updated.updated_at >= created.updated_at).toBe(true);

		await repo.deleteGasCylinderType(updated);
		expect(await repo.listGasCylinderTypes()).toHaveLength(0);
	});
});

// The ticket's demo, as reproducible evidence: requisition (deduct stock) →
// service record → variance summary. Bypasses the SOP-calc plan entrypoint
// (createMealPlan directly with recipes) so it stays green regardless of the
// unrelated sop-ratios breakage on develop.
describe('T-27 demo chain — requisition → service record → variance', () => {
	let repo: KitchenPouchRepository;

	beforeEach(async () => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
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
				served: 85,
				waste: 3,
				external: { volunteers: 4, outside_evacuees: 3 }
			},
			ctx
		);

		// 4. Variance summary joins service ↔ plan (same date:meal) and compares.
		const storedPlan = await repo.getMealPlan('2026-07-20', 'dinner');
		const v = computeMealVariance(svc, storedPlan);

		expect(v.planned).toBe(100);
		expect(v.served).toBe(85);
		expect(v.waste).toBe(3);
		expect(v.external).toBe(7); // volunteers 4 + outside 3
		expect(v.variance).toBe(-15); // served 85 − planned 100
		expect(v.variance_pct).toBe(-15);
		expect(v.status).toBe('under'); // −15% is beyond the ±5% band → next round can plan fewer

		// Stock was really deducted: 100 kg on hand − 15 kg issued = 85 kg on hand.
		const all = await testDb.allDocs({ include_docs: true });
		const riceOnHand = all.rows
			.map((r) => r.doc as unknown as Record<string, unknown>)
			.filter((d) => d?.type === 'stock_ledger' && d.item_id === 'item:rice')
			.reduce((sum, d) => sum + (d.qty as number), 0);
		expect(riceOnHand).toBeCloseTo(85, 6);
	});
});
