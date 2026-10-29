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

import {
	createBulkReturnEntry,
	createBulkReturnEntryVoid,
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import { cancelBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import {
	addBulkReturnEntries,
	findWrittenBulkReturnEntries
} from './bulk-return-pool-v3-add-entry';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import {
	getBulkReturnPoolOverview,
	listBulkReturnPoolAppliedLoanRefs,
	listBulkReturnPoolClosedLoanRefs
} from './bulk-return-pool-v3-read';
import {
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowValidationError
} from './errors';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	mgr,
	OTHER_EVACUEE,
	racingPoolRepo,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 workflows', () => {
	let poolRepo: Fx['poolRepo'];
	let eventRepo: Fx['eventRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let add: Fx['add'];
	let entryDocCount: Fx['entryDocCount'];
	let lockPool: Fx['lockPool'];
	let driftingLogRepo: Fx['driftingLogRepo'];

	beforeEach(() => {
		({
			poolRepo,
			eventRepo,
			logRepo,
			deps,
			nextOp,
			openPool,
			seedLoan,
			add,
			entryDocCount,
			lockPool,
			driftingLogRepo
		} = createBulkReturnPoolV3Fixture(couch));
	});

	describe('addBulkReturnEntries', () => {
		it('adds several item kinds repeatedly and the overview sums per item', async () => {
			const pool = await openPool('Gate A');
			await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '2' },
				{ item_id: 'item:wheelchair', qty: '1' }
			]);
			await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '3' }]);

			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.entry_count).toBe(3);
			expect(row.items).toEqual([
				{ item_id: 'item:cot', qty: '5' },
				{ item_id: 'item:wheelchair', qty: '1' }
			]);
			expect(row.is_empty).toBe(false);
		});

		it('lend 3, return 2 leaves 1 outstanding; a later return of 1 closes the loan', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(10, { qty: '3' });

			const first = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			expect(first.returner_had_outstanding_loans).toBe(true);
			expect(first.no_outstanding_loan).toBe(false);
			expect(first.results[0].loansApplied).toEqual([loanId(10)]);
			expect(first.results[0].unallocated_qty).toBe('0');
			let loan = await logRepo.get(loanId(10));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([first.results[0].entry._id]);

			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '1' }]);
			loan = await logRepo.get(loanId(10));
			expect(loan?.status).toBe('returned');
			expect(loan?.qty_returned).toBe('3');
		});

		it('allocates oldest-first across loans', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(11, { qty: '2', at: '2026-01-02T00:00:00.000Z' });
			await seedLoan(12, { qty: '2', at: '2026-01-01T00:00:00.000Z' });

			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '3' }
			]);
			expect(res.results[0].entry.loan_refs).toEqual([
				{ distribution_log_id: loanId(12), qty: '2' },
				{ distribution_log_id: loanId(11), qty: '1' }
			]);
			expect((await logRepo.get(loanId(12)))?.status).toBe('returned');
			expect((await logRepo.get(loanId(11)))?.status).toBe('partially_returned');
		});

		it('keeps quantity beyond the outstanding as unallocated', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(13, { qty: '2' });
			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '5' }
			]);
			const [r] = res.results;
			expect(r.entry.qty).toBe('5');
			expect(r.entry.loan_refs).toEqual([{ distribution_log_id: loanId(13), qty: '2' }]);
			expect(r.unallocated_qty).toBe('3');
		});

		it('does not allocate the same outstanding twice for two items of the same call', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(14, { qty: '2' });
			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' },
				{ item_id: 'item:cot', qty: '1' }
			]);
			expect(res.results.map((r) => r.loansApplied)).toEqual([[loanId(14)], [loanId(14)]]);
			expect((await logRepo.get(loanId(14)))?.status).toBe('returned');
		});

		it('allows a returner with no outstanding loan (flagged), without loan refs', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(15, { recipient: OTHER_EVACUEE });
			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			expect(res.no_outstanding_loan).toBe(true);
			expect(res.returner_had_outstanding_loans).toBe(false);
			expect(res.results[0].entry.loan_refs).toEqual([]);
			expect(res.results[0].unallocated_qty).toBe('2');
			expect((await logRepo.get(loanId(15)))?.status).toBe('active');
		});

		it('writes no loan refs for an unspecified returner', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(16);
			const res = await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '2' }]);
			expect(res.no_outstanding_loan).toBe(false);
			expect(res.returner_had_outstanding_loans).toBe(false);
			expect(res.results[0].entry.returner_type).toBe('unspecified');
			expect(res.results[0].entry.returner_id).toBeNull();
			expect(res.results[0].entry.loan_refs).toEqual([]);
			expect((await logRepo.get(loanId(16)))?.status).toBe('active');
		});

		it('rejects a non-returnable or unknown item before any write', async () => {
			const pool = await openPool('Gate A');
			await expect(
				add(pool._id, { type: 'unspecified' }, [
					{ item_id: 'item:cot', qty: '1' },
					{ item_id: 'item:rice', qty: '1' }
				])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:ghost', qty: '1' }])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(entryDocCount()).toBe(0);
		});

		it('rejects empty items, bad qty and a malformed returner', async () => {
			const pool = await openPool('Gate A');
			await expect(add(pool._id, { type: 'unspecified' }, [])).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1.5' }])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				add(pool._id, { type: 'evacuee', id: 'volunteer:x' }, [{ item_id: 'item:cot', qty: '1' }])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(entryDocCount()).toBe(0);
		});

		it('rejects a locked, non-OPEN or missing pool before any write', async () => {
			const pool = await openPool('Gate A');
			await lockPool(pool._id);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }])
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			const other = await openPool('Gate B');
			await cancelBulkReturnPool(other._id, nextOp(), mgr, deps);
			await expect(
				add(other._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }])
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			await expect(
				add(`bulk_return_pool:${U(77)}`, { type: 'unspecified' }, [
					{ item_id: 'item:cot', qty: '1' }
				])
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
			expect(entryDocCount()).toBe(0);
		});

		it('does not double-apply loans when replayed with the same operationUlids', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(17, { qty: '3' });
			const input = {
				pool_id: pool._id,
				returner: { type: 'evacuee', id: EVACUEE } as const,
				items: [{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() }]
			};
			const first = await addBulkReturnEntries(input, mgr, deps);
			const second = await addBulkReturnEntries(input, mgr, deps);

			expect(first.results[0].replayed).toBe(false);
			expect(second.results[0].replayed).toBe(true);
			expect(second.results[0].entry._id).toBe(first.results[0].entry._id);
			expect(entryDocCount()).toBe(1);
			const loan = await logRepo.get(loanId(17));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toHaveLength(1);
		});

		it('rejects a replayed operationUlid whose content differs', async () => {
			const pool = await openPool('Gate A');
			const op = nextOp();
			await addBulkReturnEntries(
				{
					pool_id: pool._id,
					returner: { type: 'unspecified' },
					items: [{ item_id: 'item:cot', qty: '2', operationUlid: op }]
				},
				mgr,
				deps
			);
			await expect(
				addBulkReturnEntries(
					{
						pool_id: pool._id,
						returner: { type: 'unspecified' },
						items: [{ item_id: 'item:cot', qty: '3', operationUlid: op }]
					},
					mgr,
					deps
				)
			).rejects.toBeInstanceOf(ConcurrencyCollisionError);
		});

		it('marks the entry late and leaves loans untouched when the pool is locked after the write', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(18, { qty: '3' });
			// The submit holds the lock at the fence, then finishes with a snapshot that lacks the entry.
			let t = 0;
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 2) await lockPool(pool._id);
				}),
				fenceClock: {
					now: () => t,
					sleep: async (ms: number) => {
						t += ms;
						await poolRepo.mutateCAS(pool._id, (cur) =>
							submitBulkReturnPoolV3(
								cur,
								{
									items_summary: [{ item_id: 'item:wheelchair', qty: '1' }],
									entry_ids: [`bulk_return_entry:${U(999)}`]
								},
								mgr
							)
						);
					}
				}
			};
			const res = await add(
				pool._id,
				{ type: 'evacuee', id: EVACUEE },
				[
					{ item_id: 'item:cot', qty: '2' },
					{ item_id: 'item:wheelchair', qty: '1' }
				],
				mgr,
				racing
			);
			// Fence tripped on the first item: it is reported late and later items are not written.
			expect(res.results).toHaveLength(1);
			expect(res.results[0].late).toBe(true);
			expect(res.results[0].loansApplied).toEqual([]);
			expect(entryDocCount()).toBe(1);
			const loan = await logRepo.get(loanId(18));
			expect(loan?.status).toBe('active');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('lists a late entry in a SUBMITTED pool and lets it be moved to an OPEN pool', async () => {
			const pool = await openPool('Gate A');
			const target = await openPool('Gate B');
			await seedLoan(19, { qty: '3' });
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 2) {
						await poolRepo.mutateCAS(pool._id, (cur) =>
							submitBulkReturnPoolV3(
								cur,
								{
									items_summary: [{ item_id: 'item:wheelchair', qty: '1' }],
									entry_ids: [`bulk_return_entry:${U(999)}`]
								},
								mgr
							)
						);
					}
				})
			};
			const res = await add(
				pool._id,
				{ type: 'evacuee', id: EVACUEE },
				[{ item_id: 'item:cot', qty: '2' }],
				mgr,
				racing
			);
			const entry = res.results[0].entry;
			expect(res.results[0].late).toBe(true);
			expect((await logRepo.get(loanId(19)))?.status).toBe('active');

			let rows = await getBulkReturnPoolOverview({}, mgr, deps);
			const poolRow = rows.find((r) => r.pool._id === pool._id);
			expect(poolRow?.late_entries.map((r) => r.entry._id)).toEqual([entry._id]);

			const moved = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				dist,
				deps
			);
			expect(moved.late).toBe(false);
			expect(moved.move.seq).toBe(1);
			expect(moved.loansApplied).toEqual([loanId(19)]);
			expect(moved.loansSkipped).toEqual([]);
			rows = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(rows.find((r) => r.pool._id === pool._id)?.late_entries).toEqual([]);
			expect(rows.find((r) => r.pool._id === target._id)?.items).toEqual([
				{ item_id: 'item:cot', qty: '2' }
			]);
			// A late entry moved into an OPEN pool applies its loan refs exactly once.
			let loan = await logRepo.get(loanId(19));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
			// The same unit cannot be returned again afterwards.
			const again = await add(target._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			expect(again.results[0].unallocated_qty).toBe('1');
			loan = await logRepo.get(loanId(19));
			expect(loan?.status).toBe('returned');
			expect(loan?.qty_returned).toBe('3');
		});
	});

	describe('loan drift (closed / insufficient / missing loan at apply time)', () => {
		const clearAsLost = (id: string) =>
			logRepo.recordClear(id, { clear_reason: 'lost', notes: 'lost in the flood' }, mgr);

		const dropOffInput = (poolId: string, qty: string, operationUlid: string) => ({
			pool_id: poolId,
			returner: { type: 'evacuee' as const, id: EVACUEE },
			items: [{ item_id: 'item:cot', qty, operationUlid }]
		});

		it('skips a loan cleared as lost between allocation and apply: no throw, entry kept, loan untouched', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(40, { qty: '3' });
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(40))) };

			const res = await addBulkReturnEntries(dropOffInput(pool._id, '2', nextOp()), mgr, drifting);

			const [first] = res.results;
			expect(first.late).toBe(false);
			expect(first.entry.loan_refs).toEqual([{ distribution_log_id: loanId(40), qty: '2' }]);
			expect(first.loansApplied).toEqual([]);
			expect(first.loansSkipped).toEqual([
				{ distribution_log_id: loanId(40), qty: '2', reason: 'closed', outstanding: '3' }
			]);
			expect(entryDocCount()).toBe(1);
			const loan = await logRepo.get(loanId(40));
			expect(loan?.status).toBe('lost');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('is idempotent on retry after drift: same skip, no throw, no second entry, loan unchanged', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(41, { qty: '3' });
			const op = nextOp();
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(41))) };
			await addBulkReturnEntries(dropOffInput(pool._id, '2', op), mgr, drifting);
			const before = await logRepo.get(loanId(41));

			const retry = await addBulkReturnEntries(dropOffInput(pool._id, '2', op), mgr, deps);
			const again = await addBulkReturnEntries(dropOffInput(pool._id, '2', op), mgr, deps);

			expect(retry.results[0].replayed).toBe(true);
			expect(retry.results[0].loansApplied).toEqual([]);
			expect(retry.results[0].loansSkipped).toEqual([
				{ distribution_log_id: loanId(41), qty: '2', reason: 'closed', outstanding: '3' }
			]);
			expect(again.results[0].loansSkipped).toEqual(retry.results[0].loansSkipped);
			expect(entryDocCount()).toBe(1);
			expect(await logRepo.get(loanId(41))).toEqual(before);
		});

		it('skips a ref whose outstanding dropped below ref.qty (no partial apply)', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(42, { qty: '3' });
			const drifting = {
				...deps,
				logRepo: driftingLogRepo(() =>
					logRepo.mutateLogCAS(loanId(42), (cur) => ({
						...cur,
						status: 'partially_returned',
						qty_returned: '2',
						returned_at: '2026-01-01T00:00:00.000Z',
						returned_by: 'user:wh1',
						clear_reason: 'routine'
					}))
				)
			};

			const res = await addBulkReturnEntries(dropOffInput(pool._id, '2', nextOp()), mgr, drifting);

			expect(res.results[0].loansApplied).toEqual([]);
			expect(res.results[0].loansSkipped).toEqual([
				{ distribution_log_id: loanId(42), qty: '2', reason: 'insufficient', outstanding: '1' }
			]);
			const loan = await logRepo.get(loanId(42));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('skips a ref whose loan doc is missing instead of throwing', async () => {
			const pool = await openPool('Gate A');
			const op = nextOp();
			await eventRepo.createEntry(
				createBulkReturnEntry(
					{
						pool_id: pool._id,
						item_id: 'item:cot',
						qty: '1',
						returner_type: 'evacuee',
						returner_id: EVACUEE,
						loan_refs: [{ distribution_log_id: loanId(99), qty: '1' }]
					},
					mgr,
					op
				)
			);

			const res = await addBulkReturnEntries(dropOffInput(pool._id, '1', op), mgr, deps);

			expect(res.results[0].loansApplied).toEqual([]);
			expect(res.results[0].loansSkipped).toEqual([
				{ distribution_log_id: loanId(99), qty: '1', reason: 'missing' }
			]);
		});

		it('still reports an already applied ref as applied on replay, even when the loan is now returned', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(43, { qty: '3' });
			const op = nextOp();
			const first = await addBulkReturnEntries(dropOffInput(pool._id, '3', op), mgr, deps);
			expect((await logRepo.get(loanId(43)))?.status).toBe('returned');
			expect(first.results[0].loansApplied).toEqual([loanId(43)]);

			const replay = await addBulkReturnEntries(dropOffInput(pool._id, '3', op), mgr, deps);

			expect(replay.results[0].replayed).toBe(true);
			expect(replay.results[0].loansApplied).toEqual([loanId(43)]);
			expect(replay.results[0].loansSkipped).toEqual([]);
			const loan = await logRepo.get(loanId(43));
			expect(loan?.qty_returned).toBe('3');
			expect(loan?.applied_bulk_entry_ids).toHaveLength(1);
		});

		it('void of an entry with a skipped ref leaves the loan untouched and does not throw', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(44, { qty: '3' });
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(44))) };
			const { results } = await addBulkReturnEntries(
				dropOffInput(pool._id, '2', nextOp()),
				mgr,
				drifting
			);
			const before = await logRepo.get(loanId(44));

			const voided = await voidBulkReturnEntry({ entry_id: results[0].entry._id }, dist, deps);

			expect(voided.replayed).toBe(false);
			expect(voided.loansReverted).toEqual([]);
			expect(await logRepo.get(loanId(44))).toEqual(before);
			expect((await logRepo.get(loanId(44)))?.status).toBe('lost');
		});

		it('lists only actually applied refs (not drift-skipped, not voided entries)', async () => {
			const pool = await openPool('Gate A');
			// Loan 48 is fully consumed by the first entry, so the second one allocates to loan 49.
			await seedLoan(48, { qty: '1', at: '2026-01-01T00:00:00.000Z' });
			await seedLoan(49, { qty: '3', at: '2026-01-02T00:00:00.000Z' });
			const applied = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const appliedEntry = applied.results[0].entry;
			expect(await listBulkReturnPoolAppliedLoanRefs(pool._id, mgr, deps)).toEqual([
				{
					entry_id: appliedEntry._id,
					distribution_log_id: appliedEntry.loan_refs[0].distribution_log_id,
					qty: appliedEntry.loan_refs[0].qty
				}
			]);

			// A drifted entry (its loan is cleared right after allocation) is not listed as applied.
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(49))) };
			await addBulkReturnEntries(dropOffInput(pool._id, '2', nextOp()), mgr, drifting);
			const listed = await listBulkReturnPoolAppliedLoanRefs(pool._id, mgr, deps);
			expect(listed.map((r) => r.entry_id)).toEqual([appliedEntry._id]);

			await voidBulkReturnEntry({ entry_id: appliedEntry._id }, dist, deps);
			expect(await listBulkReturnPoolAppliedLoanRefs(pool._id, mgr, deps)).toEqual([]);
		});

		it('void of an entry whose loan doc is gone does not throw', async () => {
			const pool = await openPool('Gate A');
			const op = nextOp();
			const entry = await eventRepo.createEntry(
				createBulkReturnEntry(
					{
						pool_id: pool._id,
						item_id: 'item:cot',
						qty: '1',
						returner_type: 'evacuee',
						returner_id: EVACUEE,
						loan_refs: [{ distribution_log_id: loanId(98), qty: '1' }]
					},
					mgr,
					op
				)
			);
			await expect(voidBulkReturnEntry({ entry_id: entry._id }, dist, deps)).resolves.toBeDefined();
		});

		it('keeps counting the entry qty in the pool total and lists the closed ref until void', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(45, { qty: '3' });
			// A plain entry without refs plus a drifted one on loan 45 (cleared right after allocation).
			await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(45))) };
			const { results } = await addBulkReturnEntries(
				dropOffInput(pool._id, '2', nextOp()),
				mgr,
				drifting
			);
			const driftedEntryId = results[0].entry._id;

			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.items).toEqual([{ item_id: 'item:cot', qty: '3' }]);
			expect(await listBulkReturnPoolClosedLoanRefs(pool._id, mgr, deps)).toEqual([
				{
					entry_id: driftedEntryId,
					distribution_log_id: loanId(45),
					qty: results[0].entry.loan_refs[0].qty,
					reason: 'closed',
					outstanding: '3',
					ticket_id: 'requisition_ticket:01J00000000000000000000001'
				}
			]);

			await voidBulkReturnEntry({ entry_id: driftedEntryId }, dist, deps);
			expect(await listBulkReturnPoolClosedLoanRefs(pool._id, mgr, deps)).toEqual([]);
			const [after] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(after.items).toEqual([{ item_id: 'item:cot', qty: '1' }]);
		});

		it('lists nothing for a pool whose refs were all applied', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(47, { qty: '3' });
			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '3' }]);
			expect(await listBulkReturnPoolClosedLoanRefs(pool._id, mgr, deps)).toEqual([]);
		});
	});

	describe('multi-line save after a fence timeout', () => {
		/**
		 * Line 1 (cot) is written, its fence times out (the submit lock never clears), then the submit
		 * commits counting line 1. Line 2 (wheelchair) is never written.
		 */
		async function line1TimedOutThenSubmitted() {
			const poolA = await openPool('Gate A');
			const poolB = await openPool('Gate B');
			await seedLoan(80, { qty: '3' });
			const returner = { type: 'evacuee' as const, id: EVACUEE };
			const items = [
				{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() },
				{ item_id: 'item:wheelchair', qty: '1', operationUlid: nextOp() }
			];
			const input = { pool_id: poolA._id, returner, items };
			let t = 0;
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 2) await lockPool(poolA._id);
				}),
				fenceClock: {
					now: () => t,
					sleep: async (ms: number) => {
						t += ms;
					}
				}
			};
			const first = await addBulkReturnEntries(input, mgr, racing);
			const events = await eventRepo.listForPool(poolA._id);
			await poolRepo.mutateCAS(poolA._id, (cur) =>
				submitBulkReturnPoolV3(
					cur,
					{
						items_summary: summarizePoolItems(
							events.entries,
							events.moves,
							poolA._id,
							events.voids
						),
						entry_ids: poolSnapshotEntryIds(
							resolveBulkReturnEntries(events.entries, events.moves, events.voids),
							poolA._id
						)
					},
					mgr
				)
			);
			return { poolA, poolB, returner, items, input, first };
		}

		it('returns the written line as loan_pending and leaves the next line unwritten instead of throwing', async () => {
			const { items, first } = await line1TimedOutThenSubmitted();

			expect(first.results).toHaveLength(1);
			expect(first.results[0]).toMatchObject({
				late: false,
				loan_pending: true,
				loansApplied: [],
				loansSkipped: []
			});
			expect(first.results[0].entry._id).toBe(`bulk_return_entry:${items[0].operationUlid}`);
			expect(entryDocCount()).toBe(1);
			expect((await logRepo.get(loanId(80)))?.applied_bulk_entry_ids ?? []).toEqual([]);
		});

		it('retry at the same (now submitted) pool cuts line 1 once on its own pool and blocks line 2 as closed', async () => {
			const { poolA, input, items } = await line1TimedOutThenSubmitted();

			const retry = await addBulkReturnEntries(input, mgr, deps);
			const again = await addBulkReturnEntries(input, mgr, deps);

			expect(retry.blocked).toEqual({ pool_id: poolA._id, reason: 'closed' });
			expect(retry.results).toHaveLength(1);
			expect(retry.results[0]).toMatchObject({ replayed: true, loansApplied: [loanId(80)] });
			expect(retry.results[0].loan_pending).toBeUndefined();
			expect(again.results[0].loansApplied).toEqual([loanId(80)]);
			const loan = await logRepo.get(loanId(80));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([`bulk_return_entry:${items[0].operationUlid}`]);
			expect(entryDocCount()).toBe(1);
		});

		it('line 2 alone can then be saved at another OPEN pool', async () => {
			const { poolB, returner, items } = await line1TimedOutThenSubmitted();

			const res = await addBulkReturnEntries(
				{ pool_id: poolB._id, returner, items: [items[1]] },
				mgr,
				deps
			);

			expect(res.blocked).toBeUndefined();
			expect(res.results).toHaveLength(1);
			expect(res.results[0].entry.pool_id).toBe(poolB._id);
			expect(res.results[0].replayed).toBe(false);
		});

		it('retry of both lines at another OPEN pool replays line 1 on its original pool and writes line 2 to the new pool', async () => {
			const { poolA, poolB, returner, items } = await line1TimedOutThenSubmitted();

			const res = await addBulkReturnEntries({ pool_id: poolB._id, returner, items }, mgr, deps);

			expect(res.blocked).toBeUndefined();
			expect(res.results.map((r) => r.entry._id)).toEqual(
				items.map((i) => `bulk_return_entry:${i.operationUlid}`)
			);
			expect(res.results[0]).toMatchObject({ replayed: true, loansApplied: [loanId(80)] });
			expect(res.results[0].entry.pool_id).toBe(poolA._id);
			expect(res.results[1].replayed).toBe(false);
			expect(res.results[1].entry.pool_id).toBe(poolB._id);
			const loan = await logRepo.get(loanId(80));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toHaveLength(1);
		});

		it('still rejects a replayed operationUlid at another pool when the qty differs', async () => {
			const { poolB, returner, items } = await line1TimedOutThenSubmitted();

			await expect(
				addBulkReturnEntries(
					{ pool_id: poolB._id, returner, items: [{ ...items[0], qty: '3' }] },
					mgr,
					deps
				)
			).rejects.toBeInstanceOf(ConcurrencyCollisionError);
		});
	});

	describe('a void racing the loan cut', () => {
		const dropOff = (poolId: string, operationUlid: string) => ({
			pool_id: poolId,
			returner: { type: 'evacuee' as const, id: EVACUEE },
			items: [{ item_id: 'item:cot', qty: '2', operationUlid }]
		});

		async function writeVoidOf(poolId: string, operationUlid: string) {
			const entry = await eventRepo.getEntry(`bulk_return_entry:${operationUlid}`);
			await eventRepo.createVoid(
				createBulkReturnEntryVoid({ entry: entry!, pool_id: poolId }, mgr)
			);
		}

		it('does not cut the loan when the void lands after the fence and before the loan CAS', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(81, { qty: '3' });
			const op = nextOp();
			const racing = {
				...deps,
				logRepo: {
					...driftingLogRepo(async () => {}),
					mutateLogCAS: async (
						...args: Parameters<typeof logRepo.mutateLogCAS>
					): Promise<Awaited<ReturnType<typeof logRepo.mutateLogCAS>>> => {
						await writeVoidOf(pool._id, op);
						return logRepo.mutateLogCAS(...args);
					}
				}
			};

			const res = await addBulkReturnEntries(dropOff(pool._id, op), mgr, racing);

			expect(res.results[0]).toMatchObject({ voided: true, loansApplied: [], loansSkipped: [] });
			const loan = await logRepo.get(loanId(81));
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned ?? '0').toBe('0');
			expect(loan?.applied_bulk_entry_ids ?? []).toEqual([]);
		});

		it('does not cut the loan when the void lands between a CAS conflict and its retry', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(82, { qty: '3' });
			const op = nextOp();
			let attempts = 0;
			const racing = {
				...deps,
				logRepo: {
					...driftingLogRepo(async () => {}),
					mutateLogCAS: (...[id, mutator, options]: Parameters<typeof logRepo.mutateLogCAS>) =>
						logRepo.mutateLogCAS(id, mutator, {
							beforeWrite: async (current) => {
								await options?.beforeWrite?.(current);
								if (++attempts !== 1) return;
								// After the first read: bump the loan (forces a 409) and void the entry.
								await logRepo.mutateLogCAS(id, (cur) => ({ ...cur, notes: 'touched' }));
								await writeVoidOf(pool._id, op);
							}
						})
				}
			};

			const res = await addBulkReturnEntries(dropOff(pool._id, op), mgr, racing);

			expect(attempts).toBe(2);
			expect(res.results[0]).toMatchObject({ voided: true, loansApplied: [] });
			const loan = await logRepo.get(loanId(82));
			expect(loan?.qty_returned ?? '0').toBe('0');
			expect(loan?.applied_bulk_entry_ids ?? []).toEqual([]);
		});
	});

	describe('findWrittenBulkReturnEntries', () => {
		it('returns qty and item for written operationUlids and omits unwritten ones', async () => {
			const pool = await openPool('Gate A');
			const written = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '4' }
			]);
			const ulid = written.results[0].entry._id.replace('bulk_return_entry:', '');
			const unwritten = nextOp();

			const found = await findWrittenBulkReturnEntries([ulid, unwritten], mgr, deps);

			expect([...found.entries()]).toEqual([[ulid, { qty: '4', item_id: 'item:cot' }]]);
		});

		it('rejects an operationUlid that is not a ULID', async () => {
			await expect(findWrittenBulkReturnEntries(['nope'], mgr, deps)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
		});
	});
});
