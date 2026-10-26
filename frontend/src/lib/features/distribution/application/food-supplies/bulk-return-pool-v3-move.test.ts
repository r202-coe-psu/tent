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
	createBulkReturnEntryMove,
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import { submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import { getBulkReturnPoolOverview } from './bulk-return-pool-v3-read';
import { BulkReturnPoolStateError, WorkflowValidationError } from './errors';
import {
	createBulkReturnPoolV3Fixture,
	EVACUEE,
	fullInput,
	loanId,
	mgr,
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
	let lockPool: Fx['lockPool'];
	let receive: Fx['receive'];

	beforeEach(() => {
		({ poolRepo, eventRepo, logRepo, deps, nextOp, openPool, seedLoan, add, lockPool, receive } =
			createBulkReturnPoolV3Fixture(couch));
	});

	describe('moveBulkReturnEntry', () => {
		/**
		 * Fence clock for a target that is locked by a submit: the first sleep lets the submit finish
		 * with a snapshot that does NOT contain the moved entry, so the entry is late.
		 */
		function submitWithoutEntryClock(poolId: string) {
			let t = 0;
			return {
				now: () => t,
				sleep: async (ms: number) => {
					t += ms;
					await poolRepo.mutateCAS(poolId, (cur) =>
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
			};
		}

		/** Writes an entry (cot x2 for the loan `n`) into a pool that is SUBMITTED before the fence. */
		async function addLateEntry(poolId: string) {
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 2) {
						await poolRepo.mutateCAS(poolId, (cur) =>
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
				poolId,
				{ type: 'evacuee', id: EVACUEE },
				[{ item_id: 'item:cot', qty: '2' }],
				mgr,
				racing
			);
			expect(res.results[0].late).toBe(true);
			return res.results[0].entry;
		}

		it('does not double-apply when moving an already-applied entry between OPEN pools', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(21, { qty: '3' });
			const { results } = await add(a._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			const entryId = results[0].entry._id;
			const moved = await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, mgr, deps);
			expect(moved.loansApplied).toEqual([]);
			expect(moved.loansSkipped).toEqual([]);
			const loan = await logRepo.get(loanId(21));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([entryId]);
		});

		it('does not double-apply a late entry when the same move is replayed', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(22, { qty: '3' });
			const entry = await addLateEntry(a._id);
			const input = { entry_id: entry._id, to_pool_id: b._id };
			const first = await moveBulkReturnEntry(input, mgr, deps);
			expect(first.loansApplied).toEqual([loanId(22)]);
			const retry = await moveBulkReturnEntry(input, mgr, deps);
			expect(retry.replayed).toBe(true);
			expect(retry.loansApplied).toEqual([]);
			const loan = await logRepo.get(loanId(22));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
		});

		it('applies nothing on a replayed move while the target is still not appendable', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(23, { qty: '3' });
			const entry = await addLateEntry(a._id);
			// First attempt: target locks right after the move doc is written -> nothing applied.
			let bGets = 0;
			const racing = {
				...deps,
				// b's reads: 1 = target check, 2 = fence after the move.
				poolRepo: racingPoolRepo(poolRepo, async (_n, id) => {
					if (id === b._id && ++bGets === 2) await lockPool(b._id);
				}),
				fenceClock: submitWithoutEntryClock(b._id)
			};
			const first = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				racing
			);
			expect(first.late).toBe(true);
			expect(first.loansApplied).toEqual([]);
			expect(first.loansSkipped).toEqual([]);
			const retry = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				deps
			);
			expect(retry).toMatchObject({ replayed: true, late: true, loansApplied: [] });
			const loan = await logRepo.get(loanId(23));
			expect(loan?.status).toBe('active');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('moves a late entry whose loan was closed meanwhile without touching the loan', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(24, { qty: '3' });
			const entry = await addLateEntry(a._id);
			await logRepo.recordClear(
				loanId(24),
				{ clear_reason: 'lost', notes: 'lost in the flood' },
				mgr
			);
			const moved = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				deps
			);
			expect(moved.late).toBe(false);
			expect(moved.loansApplied).toEqual([]);
			expect(moved.loansSkipped).toHaveLength(1);
			expect(moved.loansSkipped[0]).toMatchObject({
				distribution_log_id: loanId(24),
				reason: 'closed'
			});
			const loan = await logRepo.get(loanId(24));
			expect(loan?.status).toBe('lost');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('applies no loans for a late entry when the target turns non-appendable after the move', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(25, { qty: '3' });
			const entry = await addLateEntry(a._id);
			let bGets = 0;
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (_n, id) => {
					// b's reads: 1 = target check, 2 = fence after the move
					if (id === b._id && ++bGets === 2) await lockPool(b._id);
				}),
				fenceClock: submitWithoutEntryClock(b._id)
			};
			const moved = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				racing
			);
			expect(moved.late).toBe(true);
			expect(moved.loansApplied).toEqual([]);
			expect(moved.loansSkipped).toEqual([]);
			const loan = await logRepo.get(loanId(25));
			expect(loan?.status).toBe('active');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('moves an entry between OPEN pools without touching loans', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(20, { qty: '3' });
			const { results } = await add(a._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			const entryId = results[0].entry._id;

			const moved = await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, mgr, deps);
			expect(moved).toMatchObject({ late: false, replayed: false });
			expect(moved.loansApplied).toEqual([]);
			expect(moved.move.from_pool_id).toBe(a._id);
			expect(moved.move.to_pool_id).toBe(b._id);

			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(rows.find((r) => r.pool._id === a._id)?.is_empty).toBe(true);
			expect(rows.find((r) => r.pool._id === b._id)?.entry_count).toBe(1);
			expect((await logRepo.get(loanId(20)))?.qty_returned).toBe('2');

			// Second move uses seq 2 and leaves b again.
			const back = await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: a._id }, mgr, deps);
			expect(back.move.seq).toBe(2);
		});

		it('replays a retry of a successful move without creating a second move doc', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entryId = results[0].entry._id;
			const input = { entry_id: entryId, to_pool_id: b._id };

			const first = await moveBulkReturnEntry(input, mgr, deps);
			const retry = await moveBulkReturnEntry(input, mgr, deps);
			expect(retry.replayed).toBe(true);
			expect(retry.late).toBe(false);
			expect(retry.move._id).toBe(first.move._id);
			const { moves } = await eventRepo.listAll();
			expect(moves.filter((m) => m.entry_id === entryId)).toHaveLength(1);
		});

		it('still rejects moving an entry to the pool it was created in (no move)', async () => {
			const a = await openPool('Gate A');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await expect(
				moveBulkReturnEntry({ entry_id: results[0].entry._id, to_pool_id: a._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			const { moves } = await eventRepo.listAll();
			expect(moves).toHaveLength(0);
		});

		it('rejects a non-OPEN target, the same pool, a missing entry and a voided entry', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entryId = results[0].entry._id;

			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: a._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				moveBulkReturnEntry(
					{ entry_id: `bulk_return_entry:${U(55)}`, to_pool_id: b._id },
					mgr,
					deps
				)
			).rejects.toBeInstanceOf(WorkflowValidationError);

			await lockPool(b._id);
			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			const c = await openPool('Gate C');
			await voidBulkReturnEntry({ entry_id: entryId }, mgr, deps);
			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: c._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
		});

		it('rejects moving an entry out of a locked pool that is not late', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await lockPool(a._id);
			await expect(
				moveBulkReturnEntry({ entry_id: results[0].entry._id, to_pool_id: b._id }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
		});

		it('reports late when the target stops accepting right after the move', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			let bGets = 0;
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (_n, id) => {
					// b's reads: 1 = target check, 2 = fence after the move
					if (id === b._id && ++bGets === 2) await lockPool(b._id);
				}),
				fenceClock: submitWithoutEntryClock(b._id)
			};
			const moved = await moveBulkReturnEntry(
				{ entry_id: results[0].entry._id, to_pool_id: b._id },
				mgr,
				racing
			);
			expect(moved.late).toBe(true);
		});
	});

	describe('moving an entry out of a closed pool (no race)', () => {
		const moveKeys = () =>
			[...couch.store.keys()].filter((k) => k.startsWith('bulk_return_entry_move:'));

		async function closedPoolEntry(loanNo: number) {
			const pool = await openPool('Gate A');
			const target = await openPool('Gate B');
			await seedLoan(loanNo, { qty: '3' });
			const { results } = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			const submitted = await submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
			return { pool, submitted, target, entryId: results[0].entry._id };
		}

		async function expectRejected(entryId: string, targetId: string, loanNo: number) {
			const loanBefore = await logRepo.get(loanId(loanNo));
			const err = await moveBulkReturnEntry(
				{ entry_id: entryId, to_pool_id: targetId },
				mgr,
				deps
			).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(BulkReturnPoolStateError);
			expect((err as BulkReturnPoolStateError).name).toBe('BulkReturnPoolStateError');
			expect(['closed', 'source_closed']).toContain((err as BulkReturnPoolStateError).reason);
			expect(moveKeys()).toHaveLength(0);
			const { moves } = await eventRepo.listAll();
			expect(moves).toHaveLength(0);
			const targetRow = (await getBulkReturnPoolOverview({}, mgr, deps)).find(
				(r) => r.pool._id === targetId
			);
			expect(targetRow?.entry_count).toBe(0);
			expect(targetRow?.items).toEqual([]);
			const loan = await logRepo.get(loanId(loanNo));
			expect(loan?._rev).toBe(loanBefore?._rev);
			expect(loan?.applied_bulk_entry_ids).toEqual([entryId]);
		}

		it('rejects moving an entry counted in a SUBMITTED pool to an OPEN pool', async () => {
			const { target, entryId } = await closedPoolEntry(50);
			await expectRejected(entryId, target._id, 50);
		});

		it('rejects moving an entry counted in a RECEIVED pool to an OPEN pool', async () => {
			const { pool, submitted, target, entryId } = await closedPoolEntry(51);
			await receive(pool._id, fullInput(submitted));
			expect((await poolRepo.get(pool._id))?.status).toBe('RECEIVED');
			await expectRejected(entryId, target._id, 51);
		});
	});

	describe('P1 -> P2 -> P3 chain with P2 snapshotted between the moves', () => {
		it('keeps the entry in P2 (snapshot pin), flags a move conflict and keeps it out of P3', async () => {
			const p1 = await openPool('Gate A');
			const p2 = await openPool('Gate B');
			const p3 = await openPool('Gate C');
			const { results } = await add(p1._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			const entry = results[0].entry;
			const first = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: p2._id },
				mgr,
				deps
			);
			expect(first.move.seq).toBe(1);

			// P2 submits with the entry in its snapshot, then the seq 2 move (P2 -> P3) lands.
			const events = await eventRepo.listAll();
			await poolRepo.mutateCAS(p2._id, (cur) =>
				submitBulkReturnPoolV3(
					cur,
					{
						items_summary: summarizePoolItems(events.entries, events.moves, p2._id, events.voids),
						entry_ids: poolSnapshotEntryIds(
							resolveBulkReturnEntries(events.entries, events.moves, events.voids),
							p2._id
						)
					},
					mgr
				)
			);
			expect((await poolRepo.get(p2._id))?.entry_ids).toEqual([entry._id]);
			await eventRepo.createMove(
				createBulkReturnEntryMove({ entry, seq: 2, from_pool_id: p2._id, to_pool_id: p3._id }, mgr)
			);

			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			const row2 = rows.find((r) => r.pool._id === p2._id)!;
			const row3 = rows.find((r) => r.pool._id === p3._id)!;
			expect(row2.items).toEqual([{ item_id: 'item:cot', qty: '2' }]);
			expect(row2.entry_count).toBe(1);
			expect(row2.snapshot_conflicts).toEqual([{ entry_id: entry._id, kind: 'move' }]);
			expect(row3.items).toEqual([]);
			expect(row3.entry_count).toBe(0);
			expect(row3.snapshot_conflicts).toEqual([]);
		});
	});

	describe('entry pending sync (move chain gap)', () => {
		// Only move seq 2 (b -> c) has replicated; seq 1 (a -> b) has not.
		async function seedGap() {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entry = results[0].entry;
			await eventRepo.createMove(
				createBulkReturnEntryMove({ entry, seq: 2, from_pool_id: b._id, to_pool_id: c._id }, mgr)
			);
			return { a, b, c, entry };
		}
		const keysWith = (prefix: string) =>
			[...couch.store.keys()].filter((k) => k.startsWith(prefix));

		it('rejects a move and writes nothing', async () => {
			const { a, entry } = await seedGap();
			await expect(
				moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: a._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(keysWith('bulk_return_entry_move:')).toHaveLength(1);
		});

		it('rejects a void and writes nothing', async () => {
			const { entry } = await seedGap();
			await expect(voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			expect(keysWith('bulk_return_entry_void:')).toHaveLength(0);
		});

		it('does not crash the overview and surfaces the gap on its pools', async () => {
			const { a, b, c } = await seedGap();
			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			for (const row of rows) {
				expect(row.entry_count).toBe(0);
				expect(row.unresolved_refs.map((r) => r.kind)).toEqual(['move_gap']);
			}
			expect(rows.map((r) => r.pool._id).sort()).toEqual([a._id, b._id, c._id].sort());
		});
	});
});
