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
	buildBulkReturnPoolOverview,
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import { submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	mgr,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

/** Virtual clock for the fence: `sleep` advances time and runs `onSleep` (the other actor's step). */
function virtualClock(onSleep: (call: number) => Promise<void> = async () => {}) {
	let t = 0;
	let calls = 0;
	return {
		now: () => t,
		sleep: async (ms: number) => {
			t += ms;
			calls++;
			await onSleep(calls);
		}
	};
}

describe('bulk return pool v3 — snapshot pin (void / move racing the source submit)', () => {
	let poolRepo: Fx['poolRepo'];
	let eventRepo: Fx['eventRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let lockPool: Fx['lockPool'];
	let add: Fx['add'];

	beforeEach(() => {
		({ poolRepo, eventRepo, logRepo, deps, nextOp, openPool, seedLoan, lockPool, add } =
			createBulkReturnPoolV3Fixture(couch));
	});

	/** Submit step 2 (after the lock): snapshot the pool's live entries as the real workflow does. */
	async function snapshotOf(poolId: string) {
		const events = await eventRepo.listForPool(poolId);
		return {
			items_summary: summarizePoolItems(events.entries, events.moves, poolId, events.voids),
			entry_ids: poolSnapshotEntryIds(
				resolveBulkReturnEntries(events.entries, events.moves, events.voids),
				poolId
			)
		};
	}

	/** Submit step 3: write SUBMITTED with the snapshot (clears the lock). */
	const finishSubmit = (poolId: string, snapshot: Awaited<ReturnType<typeof snapshotOf>>) =>
		poolRepo.mutateCAS(poolId, (cur) => submitBulkReturnPoolV3(cur, snapshot, mgr));

	/**
	 * Deps where a submit locks + snapshots `poolId` right AFTER the workflow's state check of it
	 * (which still saw OPEN), and finishes while the fence waits out the lock.
	 */
	function submitAfterCheck(poolId: string) {
		let snapshot: Awaited<ReturnType<typeof snapshotOf>> | null = null;
		let reads = 0;
		return {
			...deps,
			poolRepo: {
				create: poolRepo.create.bind(poolRepo),
				list: poolRepo.list.bind(poolRepo),
				listWithSkipped: poolRepo.listWithSkipped.bind(poolRepo),
				update: poolRepo.update.bind(poolRepo),
				mutateCAS: poolRepo.mutateCAS.bind(poolRepo),
				get: async (id: string) => {
					const pool = await poolRepo.get(id);
					// Reads of the pool: 1 = snapshot pin load, 2 = the state check (still OPEN).
					if (id === poolId && ++reads === 2) {
						await lockPool(poolId);
						snapshot = await snapshotOf(poolId);
					}
					return pool;
				}
			},
			fenceClock: virtualClock(async () => {
				if (!snapshot) return;
				const done = snapshot;
				snapshot = null;
				await finishSubmit(poolId, done);
			})
		};
	}

	const dropOff = (poolId: string) => ({
		pool_id: poolId,
		returner: { type: 'evacuee' as const, id: EVACUEE },
		items: [{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() }]
	});

	async function addWithLoan(poolId: string, loanN: number) {
		await seedLoan(loanN, { qty: '3' });
		const res = await addBulkReturnEntries(dropOff(poolId), dist, deps);
		expect((await logRepo.get(loanId(loanN)))?.status).toBe('partially_returned');
		return res.results[0].entry;
	}

	const overview = async () =>
		buildBulkReturnPoolOverview(await poolRepo.list(), await eventRepo.listAll());

	describe('void racing the own-pool submit', () => {
		it('keeps the entry in the snapshot, reverts no loan and reports a void conflict', async () => {
			const pool = await openPool('Gate A');
			const entry = await addWithLoan(pool._id, 70);

			const res = await voidBulkReturnEntry(
				{ entry_id: entry._id },
				mgr,
				submitAfterCheck(pool._id)
			);

			const final = await poolRepo.get(pool._id);
			expect(final?.status).toBe('SUBMITTED');
			expect(final?.entry_ids).toEqual([entry._id]);
			expect(res.snapshot_conflict).toBe(true);
			expect(res.loansReverted).toEqual([]);
			const loan = await logRepo.get(loanId(70));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);

			const [row] = await overview();
			expect(row.entry_count).toBe(1);
			expect(row.is_empty).toBe(false);
			expect(row.items).toEqual([{ item_id: 'item:cot', qty: '2' }]);
			expect(row.entries.every((r) => !r.voided)).toBe(true);
			expect(row.snapshot_conflicts).toEqual([{ entry_id: entry._id, kind: 'void' }]);
		});

		it('keeps reporting the conflict and never reverts when the void is replayed', async () => {
			const pool = await openPool('Gate A');
			const entry = await addWithLoan(pool._id, 71);
			await voidBulkReturnEntry({ entry_id: entry._id }, mgr, submitAfterCheck(pool._id));

			const again = await voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps);

			expect(again.replayed).toBe(true);
			expect(again.snapshot_conflict).toBe(true);
			expect(again.loansReverted).toEqual([]);
			expect((await logRepo.get(loanId(71)))?.status).toBe('partially_returned');
		});

		it('behaves as before on an OPEN pool with no race', async () => {
			const pool = await openPool('Gate A');
			const entry = await addWithLoan(pool._id, 72);

			const res = await voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps);

			expect(res.snapshot_conflict).toBe(false);
			expect(res.loansReverted).toEqual([loanId(72)]);
			expect((await logRepo.get(loanId(72)))?.status).toBe('active');
			const [row] = await overview();
			expect(row.entry_count).toBe(0);
			expect(row.snapshot_conflicts).toEqual([]);
		});
	});

	describe('move racing the source submit', () => {
		it('keeps the entry in the source snapshot only and never in the target', async () => {
			const source = await openPool('Gate A');
			const target = await openPool('Gate B');
			const entry = await addWithLoan(source._id, 73);

			const res = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				mgr,
				submitAfterCheck(source._id)
			);

			const finalSource = await poolRepo.get(source._id);
			expect(finalSource?.status).toBe('SUBMITTED');
			expect(finalSource?.entry_ids).toEqual([entry._id]);
			expect(res).toMatchObject({
				snapshot_conflict: true,
				late: false,
				loansApplied: [],
				loansSkipped: []
			});
			const loan = await logRepo.get(loanId(73));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);

			const rows = await overview();
			const sourceRow = rows.find((r) => r.pool._id === source._id)!;
			const targetRow = rows.find((r) => r.pool._id === target._id)!;
			expect(sourceRow.items).toEqual([{ item_id: 'item:cot', qty: '2' }]);
			expect(sourceRow.snapshot_conflicts).toEqual([{ entry_id: entry._id, kind: 'move' }]);
			expect(sourceRow.late_entries).toEqual([]);
			expect(targetRow.items).toEqual([]);
			expect(targetRow.entry_count).toBe(0);
			expect(targetRow.snapshot_conflicts).toEqual([]);

			// Submitting the target later does not re-count the entry.
			await add(target._id, { type: 'unspecified' }, [{ item_id: 'item:wheelchair', qty: '1' }]);
			const submitted = await submitBulkReturnPool(target._id, nextOp(), mgr, deps);
			expect(submitted.entry_ids).toHaveLength(1);
			expect(submitted.entry_ids).not.toContain(entry._id);
			expect(submitted.items_summary).toEqual([{ item_id: 'item:wheelchair', qty: '1' }]);
		});

		it('keeps reporting the conflict and never touches loans when the move is replayed', async () => {
			const source = await openPool('Gate A');
			const target = await openPool('Gate B');
			const entry = await addWithLoan(source._id, 74);
			await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				mgr,
				submitAfterCheck(source._id)
			);

			const again = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				mgr,
				deps
			);

			expect(again).toMatchObject({
				replayed: true,
				snapshot_conflict: true,
				late: false,
				loansApplied: []
			});
			expect((await logRepo.get(loanId(74)))?.applied_bulk_entry_ids).toEqual([entry._id]);
			expect((await logRepo.get(loanId(74)))?.status).toBe('partially_returned');
			const targetRow = (await overview()).find((r) => r.pool._id === target._id)!;
			expect(targetRow.entry_count).toBe(0);
		});

		it('behaves as before between OPEN pools with no race', async () => {
			const source = await openPool('Gate A');
			const target = await openPool('Gate B');
			const entry = await addWithLoan(source._id, 75);

			const res = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				mgr,
				deps
			);

			expect(res.snapshot_conflict).toBe(false);
			expect(res.late).toBe(false);
			const rows = await overview();
			expect(rows.find((r) => r.pool._id === source._id)!.entry_count).toBe(0);
			const targetRow = rows.find((r) => r.pool._id === target._id)!;
			expect(targetRow.entry_count).toBe(1);
			expect(targetRow.items).toEqual([{ item_id: 'item:cot', qty: '2' }]);
			expect(targetRow.snapshot_conflicts).toEqual([]);
		});
	});
});
