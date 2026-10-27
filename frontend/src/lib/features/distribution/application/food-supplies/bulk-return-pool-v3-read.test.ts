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
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import {
	getBulkReturnPoolOverview,
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
	let logRepo: Fx['logRepo'];
	let driftingLogRepo: Fx['driftingLogRepo'];

	beforeEach(() => {
		({ deps, nextOp, openPool, seedLoan, add, logRepo, driftingLogRepo } =
			createBulkReturnPoolV3Fixture(couch));
	});

	describe('getBulkReturnPoolOverview closed_loan_refs', () => {
		const cotInput = (poolId: string, qty: string) => ({
			pool_id: poolId,
			returner: { type: 'evacuee' as const, id: EVACUEE },
			items: [{ item_id: 'item:cot', qty, operationUlid: nextOp() }]
		});

		it('flags a ref whose loan was closed before it was applied; applied refs are clean', async () => {
			const closedPool = await openPool('Closed');
			const cleanPool = await openPool('Clean');
			await seedLoan(50, { qty: '3' });
			await seedLoan(51, { qty: '3', recipient: OTHER_EVACUEE });
			const drifting = {
				...deps,
				logRepo: driftingLogRepo(() =>
					logRepo.recordClear(loanId(50), { clear_reason: 'lost', notes: 'x' }, mgr)
				)
			};
			await addBulkReturnEntries(cotInput(closedPool._id, '2'), mgr, drifting);
			await add(cleanPool._id, { type: 'evacuee', id: OTHER_EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);

			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			const closedRow = rows.find((r) => r.pool._id === closedPool._id)!;
			const cleanRow = rows.find((r) => r.pool._id === cleanPool._id)!;
			expect(closedRow.closed_loan_refs).toEqual([
				{
					entry_id: closedRow.entries[0].entry._id,
					distribution_log_id: loanId(50),
					qty: '2',
					reason: 'closed',
					outstanding: '3',
					ticket_id: 'requisition_ticket:01J00000000000000000000001'
				}
			]);
			expect(cleanRow.closed_loan_refs).toEqual([]);
		});

		it('treats a loan doc that is gone as missing', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(52, { qty: '3' });
			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '2' }]);
			couch.store.delete(loanId(52));

			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.closed_loan_refs.map((r) => r.reason)).toEqual(['missing']);
		});

		it('reads the loans in one getMany call regardless of the pool count', async () => {
			await seedLoan(53, { qty: '3' });
			await seedLoan(54, { qty: '3', recipient: OTHER_EVACUEE });
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await openPool('Gate C');
			await add(a._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '1' }]);
			await add(b._id, { type: 'evacuee', id: OTHER_EVACUEE }, [{ item_id: 'item:cot', qty: '1' }]);

			const getMany = vi.spyOn(logRepo, 'getMany');
			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(rows).toHaveLength(3);
			expect(getMany).toHaveBeenCalledTimes(1);
			expect(getMany.mock.calls[0][0].slice().sort()).toEqual([loanId(53), loanId(54)]);
		});

		it('does not read loans when no entry carries a loan ref', async () => {
			const pool = await openPool('Gate A');
			await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			const getMany = vi.spyOn(logRepo, 'getMany');
			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.closed_loan_refs).toEqual([]);
			expect(getMany).not.toHaveBeenCalled();
		});
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
