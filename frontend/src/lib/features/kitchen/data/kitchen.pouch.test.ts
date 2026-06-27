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

import { KitchenPouchRepository } from './kitchen.pouch';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

describe('KitchenPouchRepository.issueRequisition — spike: ledger deduction pattern', () => {
	let repo: KitchenPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new KitchenPouchRepository();
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
});
