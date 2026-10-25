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

import { cancelBulkReturnPool, submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import {
	listBulkReturnPoolAppliedLoanRefs,
	listBulkReturnPoolClosedLoanRefs,
	listReturnerOutstandingLoans
} from './bulk-return-pool-v3-read';
import { BulkReturnPoolNotEmptyError, WorkflowValidationError } from './errors';
import {
	createBulkReturnPoolV3Fixture,
	EVACUEE,
	loanId,
	mgr,
	OTHER_EVACUEE,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 workflows', () => {
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let add: Fx['add'];

	beforeEach(() => {
		({ deps, nextOp, openPool, seedLoan, add } = createBulkReturnPoolV3Fixture(couch));
	});

	describe('pool- and entry-scoped event reads', () => {
		const one = async (
			poolId: string,
			item: string,
			qty: string,
			returner: Parameters<typeof add>[1] = { type: 'unspecified' }
		) => (await add(poolId, returner, [{ item_id: item, qty }])).results[0].entry;

		/** An entry doc another pool owns that no schema accepts: a shelter-wide read would throw on it. */
		const plantBadDocIn = (poolId: string) => {
			const id = `bulk_return_entry:${U(777)}`;
			couch.store.set(id, { _id: id, type: 'bulk_return_entry', pool_id: poolId });
		};

		it('submit snapshot includes a moved-in entry and excludes a moved-out one', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const stays = await one(a._id, 'item:cot', '2');
			const movedIn = await one(b._id, 'item:cot', '3');
			const movedOut = await one(a._id, 'item:wheelchair', '1');
			await moveBulkReturnEntry({ entry_id: movedIn._id, to_pool_id: a._id }, mgr, deps);
			await moveBulkReturnEntry({ entry_id: movedOut._id, to_pool_id: c._id }, mgr, deps);

			const submitted = await submitBulkReturnPool(a._id, nextOp(), mgr, deps);
			expect(submitted.items_summary).toEqual([{ item_id: 'item:cot', qty: '5' }]);
			expect(submitted.entry_ids).toEqual([stays._id, movedIn._id].sort());
		});

		it('cancel sees a moved-in entry as live and an entry moved away as gone', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const entry = await one(b._id, 'item:cot', '1');
			await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: a._id }, mgr, deps);

			await expect(cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolNotEmptyError
			);
			await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: c._id }, mgr, deps);
			expect((await cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');
		});

		it('loan-ref reads of a pool include its moved-in entries only', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(31, { qty: '3' });
			const entry = await one(b._id, 'item:cot', '2', {
				type: 'evacuee',
				id: EVACUEE
			});
			await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: a._id }, mgr, deps);

			expect(await listBulkReturnPoolAppliedLoanRefs(a._id, mgr, deps)).toHaveLength(1);
			expect(await listBulkReturnPoolAppliedLoanRefs(b._id, mgr, deps)).toHaveLength(0);
			expect(await listBulkReturnPoolClosedLoanRefs(a._id, mgr, deps)).toHaveLength(0);
		});

		it('an invalid doc of another pool does not block submit or cancel of this pool', async () => {
			const a = await openPool('Gate A');
			const empty = await openPool('Gate Empty');
			const b = await openPool('Gate B');
			await one(a._id, 'item:cot', '2');
			plantBadDocIn(b._id);

			const submitted = await submitBulkReturnPool(a._id, nextOp(), mgr, deps);
			expect(submitted.items_summary).toEqual([{ item_id: 'item:cot', qty: '2' }]);
			expect((await cancelBulkReturnPool(empty._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');
		});

		it('an invalid doc of another pool does not block moving or voiding an unrelated entry', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const toMove = await one(a._id, 'item:cot', '1');
			const toVoid = await one(a._id, 'item:cot', '1');
			plantBadDocIn(c._id);

			const moved = await moveBulkReturnEntry(
				{ entry_id: toMove._id, to_pool_id: b._id },
				mgr,
				deps
			);
			expect(moved.move.to_pool_id).toBe(b._id);
			const voided = await voidBulkReturnEntry({ entry_id: toVoid._id }, mgr, deps);
			expect(voided.entryVoid.entry_id).toBe(toVoid._id);
		});
	});

	describe('listReturnerOutstandingLoans', () => {
		it('returns only the returner outstanding returnable loans, oldest first', async () => {
			await seedLoan(40, { qty: '2', at: '2026-01-03T00:00:00.000Z' });
			await seedLoan(41, { qty: '2', item: 'item:wheelchair', at: '2026-01-01T00:00:00.000Z' });
			await seedLoan(42, { recipient: OTHER_EVACUEE });
			const pool = await openPool('Gate A');
			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '2' }]);

			const loans = await listReturnerOutstandingLoans(EVACUEE, mgr, deps);
			expect(loans.map((l) => l._id)).toEqual([loanId(41)]);
			await expect(listReturnerOutstandingLoans('household:x', mgr, deps)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
		});
	});
});
