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
	isLateEntry,
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import { submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { BulkReturnPoolLockTimeoutError } from './errors';
import { POOL_FENCE_SETTLE_TIMEOUT_MS } from './bulk-return-pool-v3-shared';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	mgr,
	racingPoolRepo,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

/** Virtual clock for the fence: `sleep` advances time and runs `onSleep` (the other actor's step). */
function virtualClock(onSleep: (call: number) => Promise<void> = async () => {}) {
	let t = 0;
	let calls = 0;
	return {
		clock: {
			now: () => t,
			sleep: async (ms: number) => {
				t += ms;
				calls++;
				await onSleep(calls);
			}
		},
		sleeps: () => calls
	};
}

describe('bulk return pool v3 — submit vs add-entry race (fence settles on the final pool state)', () => {
	let poolRepo: Fx['poolRepo'];
	let eventRepo: Fx['eventRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let lockPool: Fx['lockPool'];

	beforeEach(() => {
		({ poolRepo, eventRepo, logRepo, deps, nextOp, openPool, seedLoan, lockPool } =
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

	const dropOff = (poolId: string, qty = '2', operationUlid = nextOp()) => ({
		pool_id: poolId,
		returner: { type: 'evacuee' as const, id: EVACUEE },
		items: [{ item_id: 'item:cot', qty, operationUlid }]
	});

	it('applies the loans of an entry the submit snapshot counted (lock set → entry written → snapshot → lock released)', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(60, { qty: '3' });
		let snapshot: Awaited<ReturnType<typeof snapshotOf>> | null = null;
		let submitted = false;
		const finish = async () => {
			if (submitted || !snapshot) return;
			submitted = true;
			await finishSubmit(pool._id, snapshot);
		};
		// Fence read (2nd pool get): submit has locked the pool and already snapshotted our entry.
		const racing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				if (n !== 2) return;
				await lockPool(pool._id);
				snapshot = await snapshotOf(pool._id);
			}),
			fenceClock: virtualClock(finish).clock
		};

		const res = await addBulkReturnEntries(dropOff(pool._id), dist, racing);
		await finish(); // the submit completes regardless of when the add returns

		const entry = res.results[0].entry;
		const final = await poolRepo.get(pool._id);
		expect(final?.status).toBe('SUBMITTED');
		expect(final?.entry_ids).toContain(entry._id);
		// In the snapshot: not late, loans cut exactly like a normal drop-off.
		expect(res.results[0].late).toBe(false);
		expect(res.results[0].loansApplied).toEqual([loanId(60)]);
		const loan = await logRepo.get(loanId(60));
		expect(loan?.status).toBe('partially_returned');
		expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
		expect(isLateEntry(entry._id, final!)).toBe(false);
	});

	it('reports late (loans untouched) when the pool ends SUBMITTED without the entry', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(61, { qty: '3' });
		let snapshot: Awaited<ReturnType<typeof snapshotOf>> | null = null;
		const racing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				// Submit locked and snapshotted BEFORE our entry was written (1st get = pre-write check).
				if (n === 2) await lockPool(pool._id);
			}),
			fenceClock: virtualClock(async () => {
				if (snapshot) return;
				snapshot = {
					items_summary: [{ item_id: 'item:wheelchair', qty: '1' }],
					entry_ids: [`bulk_return_entry:${U(998)}`]
				};
				await finishSubmit(pool._id, snapshot);
			}).clock
		};

		const res = await addBulkReturnEntries(dropOff(pool._id), dist, racing);

		expect(res.results[0].late).toBe(true);
		expect(res.results[0].loansApplied).toEqual([]);
		expect((await logRepo.get(loanId(61)))?.status).toBe('active');
		const final = await poolRepo.get(pool._id);
		expect(isLateEntry(res.results[0].entry._id, final!)).toBe(true);
	});

	it('applies the loans normally when the lock is released and the pool stays OPEN (submit failed)', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(62, { qty: '3' });
		const racing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				if (n === 2) await lockPool(pool._id);
			}),
			fenceClock: virtualClock(async (call) => {
				if (call === 2) await poolRepo.mutateCAS(pool._id, (cur) => ({ ...cur, lock: null }));
			}).clock
		};

		const res = await addBulkReturnEntries(dropOff(pool._id), dist, racing);

		expect(res.results[0].late).toBe(false);
		expect(res.results[0].loansApplied).toEqual([loanId(62)]);
		expect((await poolRepo.get(pool._id))?.status).toBe('OPEN');
	});

	it('gives up with a retryable error when the lock never clears; a retry after it clears is idempotent', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(63, { qty: '3' });
		const { clock, sleeps } = virtualClock();
		const racing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				if (n === 2) await lockPool(pool._id);
			}),
			fenceClock: clock
		};
		const input = dropOff(pool._id);

		await expect(addBulkReturnEntries(input, dist, racing)).rejects.toBeInstanceOf(
			BulkReturnPoolLockTimeoutError
		);
		expect(clock.now()).toBeGreaterThanOrEqual(POOL_FENCE_SETTLE_TIMEOUT_MS);
		expect(sleeps()).toBeLessThan(50); // bounded backoff, not a busy poll
		expect((await logRepo.get(loanId(63)))?.status).toBe('active');

		// The stuck submit is cleared (lock released, pool OPEN); the same operationUlid replays.
		await poolRepo.mutateCAS(pool._id, (cur) => ({ ...cur, lock: null }));
		const retry = await addBulkReturnEntries(input, dist, deps);
		expect(retry.results[0].replayed).toBe(true);
		expect(retry.results[0].late).toBe(false);
		expect(retry.results[0].loansApplied).toEqual([loanId(63)]);
	});

	it('stops after an in-snapshot item: later items are not written into the submitted pool', async () => {
		const pool = await openPool('Gate A');
		let snapshot: Awaited<ReturnType<typeof snapshotOf>> | null = null;
		const racing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				if (n !== 2) return;
				await lockPool(pool._id);
				snapshot = await snapshotOf(pool._id);
			}),
			fenceClock: virtualClock(async () => {
				if (snapshot) await finishSubmit(pool._id, snapshot);
				snapshot = null;
			}).clock
		};

		const res = await addBulkReturnEntries(
			{
				pool_id: pool._id,
				returner: { type: 'unspecified' },
				items: [
					{ item_id: 'item:cot', qty: '1', operationUlid: nextOp() },
					{ item_id: 'item:wheelchair', qty: '1', operationUlid: nextOp() }
				]
			},
			dist,
			racing
		);

		expect(res.results).toHaveLength(1);
		expect(res.results[0].late).toBe(false);
		const events = await eventRepo.listForPool(pool._id);
		expect(events.entries.map((e) => e.item_id)).toEqual(['item:cot']);
	});

	it('move fence: a late entry moved into a pool whose submit counted it gets its loans applied', async () => {
		const source = await openPool('Gate A');
		const target = await openPool('Gate B');
		await seedLoan(64, { qty: '3' });
		// Make a late entry in `source` (submitted before the fence read, entry not in the snapshot).
		const lateRacing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				if (n === 2) {
					await finishSubmit(source._id, {
						items_summary: [{ item_id: 'item:wheelchair', qty: '1' }],
						entry_ids: [`bulk_return_entry:${U(997)}`]
					});
				}
			})
		};
		const late = await addBulkReturnEntries(dropOff(source._id), dist, lateRacing);
		expect(late.results[0].late).toBe(true);
		const entry = late.results[0].entry;

		// Move: target gets locked + snapshotted (counting the moved entry) right at the move fence.
		let snapshot: Awaited<ReturnType<typeof snapshotOf>> | null = null;
		let gets = 0;
		const moveRacing = {
			...deps,
			poolRepo: {
				...poolRepo,
				get: async (id: string) => {
					if (id === target._id && ++gets === 2) {
						await lockPool(target._id);
						snapshot = await snapshotOf(target._id);
					}
					return poolRepo.get(id);
				},
				mutateCAS: poolRepo.mutateCAS.bind(poolRepo),
				list: poolRepo.list.bind(poolRepo),
				listWithSkipped: poolRepo.listWithSkipped.bind(poolRepo),
				create: poolRepo.create.bind(poolRepo),
				update: poolRepo.update.bind(poolRepo)
			},
			fenceClock: virtualClock(async () => {
				if (snapshot) await finishSubmit(target._id, snapshot);
				snapshot = null;
			}).clock
		};

		const moved = await moveBulkReturnEntry(
			{ entry_id: entry._id, to_pool_id: target._id },
			dist,
			moveRacing
		);

		const final = await poolRepo.get(target._id);
		expect(final?.status).toBe('SUBMITTED');
		expect(final?.entry_ids).toContain(entry._id);
		expect(moved.late).toBe(false);
		expect(moved.loansApplied).toEqual([loanId(64)]);
		expect((await logRepo.get(loanId(64)))?.applied_bulk_entry_ids).toEqual([entry._id]);
	});

	it('30 rounds of a real submit racing a real drop-off never leave an inconsistent entry', async () => {
		// Microtask offsets: negative delays the submit (it locks mid-add), positive delays the add.
		const offsets = Array.from({ length: 30 }, (_, i) => (i - 15) * 2);
		const yieldTimes = async (n: number) => {
			for (let i = 0; i < n; i++) await Promise.resolve();
		};
		const tally = { applied: 0, late: 0, rejected: 0 };
		for (const [round, offset] of offsets.entries()) {
			const pool = await openPool(`Race ${round}`);
			await addBulkReturnEntries(
				{
					pool_id: pool._id,
					returner: { type: 'unspecified' },
					items: [{ item_id: 'item:wheelchair', qty: '1', operationUlid: nextOp() }]
				},
				mgr,
				deps
			);
			await seedLoan(100 + round, { qty: '3' });
			const submit = (async () => {
				await yieldTimes(Math.max(0, -offset));
				return submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
			})().catch((e: unknown) => e as Error);
			const add = (async () => {
				await yieldTimes(Math.max(0, offset));
				return addBulkReturnEntries(dropOff(pool._id, '1'), dist, deps);
			})().catch((e: unknown) => e as Error);
			const [, added] = await Promise.all([submit, add]);

			if (added instanceof Error) {
				tally.rejected++; // rejected before any write
				expect(added.name).toMatch(/BulkReturnPoolStateError|BulkReturnPoolLockTimeoutError/);
				continue;
			}
			const [result] = added.results;
			const final = (await poolRepo.get(pool._id))!;
			const counted = final.status === 'OPEN' || (final.entry_ids ?? []).includes(result.entry._id);
			// Oldest-first allocation may pick an earlier round's loan: check the refs the entry holds.
			expect(result.entry.loan_refs).toHaveLength(1);
			const loan = await logRepo.get(result.entry.loan_refs[0].distribution_log_id);
			const loanCut = (loan?.applied_bulk_entry_ids ?? []).includes(result.entry._id);
			// Invariant: counted in the pool ⇔ loans cut ⇔ not late. A late entry must be movable.
			expect({ round, counted, loanCut, late: result.late }).toEqual({
				round,
				counted: !result.late,
				loanCut: !result.late,
				late: result.late
			});
			expect(isLateEntry(result.entry._id, final)).toBe(result.late);
			if (result.late) tally.late++;
			else tally.applied++;
		}
		expect(tally.applied + tally.late + tally.rejected).toBe(30);
	});
});
