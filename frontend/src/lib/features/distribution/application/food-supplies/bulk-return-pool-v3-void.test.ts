// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const couch = await vi.hoisted(async () => {
	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
	return createInMemoryCouch();
});

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/couch-db', () => couch.couchDbModule);

vi.mock('$lib/features/catalog', () => ({
	catalogRepository: () => ({
		listItemMasters: async () => [],
		listUnitsOfMeasure: async () => []
	}),
	itemMasterUnit: (item: { base_unit?: string; unit?: string }) =>
		item.base_unit ?? item.unit ?? 'piece',
	canonicalizeUnitCode: (value: unknown) => value
}));

import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import { getBulkReturnPoolOverview } from './bulk-return-pool-v3-read';
import { BulkReturnPoolStateError, WorkflowValidationError } from './errors';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	mgr,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 workflows', () => {
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let add: Fx['add'];
	let lockPool: Fx['lockPool'];

	beforeEach(() => {
		({ logRepo, deps, openPool, seedLoan, add, lockPool } = createBulkReturnPoolV3Fixture(couch));
	});

	describe('voidBulkReturnEntry', () => {
		it('reopens the loan, clears applied ids and is idempotent on replay', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(30, { qty: '3' });
			const { results } = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '3' }
			]);
			const entryId = results[0].entry._id;
			expect((await logRepo.get(loanId(30)))?.status).toBe('returned');

			const voided = await voidBulkReturnEntry({ entry_id: entryId, notes: 'oops' }, dist, deps);
			expect(voided.replayed).toBe(false);
			expect(voided.loansReverted).toEqual([loanId(30)]);
			const loanAfterVoid = await logRepo.get(loanId(30));
			let loan = await logRepo.get(loanId(30));
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned).toBe('0');
			expect(loan?.applied_bulk_entry_ids).toEqual([]);

			const again = await voidBulkReturnEntry({ entry_id: entryId }, dist, deps);
			expect(again.replayed).toBe(true);
			expect(again.loansReverted).toEqual([]);
			expect((await logRepo.get(loanId(30)))?._rev).toBe(loanAfterVoid?._rev);
			expect(again.entryVoid._id).toBe(voided.entryVoid._id);
			loan = await logRepo.get(loanId(30));
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned).toBe('0');

			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.is_empty).toBe(true);
			expect(row.items).toEqual([]);
		});

		it('reverts one of two entries to partially_returned', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(31, { qty: '3' });
			const first = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '2' }]);
			await voidBulkReturnEntry({ entry_id: first.results[0].entry._id }, mgr, deps);
			const loan = await logRepo.get(loanId(31));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
		});

		it('rejects a missing entry and a pool that is not OPEN and unlocked', async () => {
			const pool = await openPool('Gate A');
			const { results } = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await expect(
				voidBulkReturnEntry({ entry_id: `bulk_return_entry:${U(56)}` }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);

			await lockPool(pool._id);
			await expect(
				voidBulkReturnEntry({ entry_id: results[0].entry._id }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
			expect(
				[...couch.store.keys()].filter((k) => k.startsWith('bulk_return_entry_void:'))
			).toHaveLength(0);
		});
	});
});
