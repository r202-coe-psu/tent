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

import { submitBulkReturnPoolV3 } from '../../domain/food-supplies';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { BulkReturnPoolLockTimeoutError } from './errors';
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

/** Virtual clock for the fence: `sleep` advances time so a never-clearing lock times out. */
function virtualClock() {
	let t = 0;
	return {
		now: () => t,
		sleep: async (ms: number) => {
			t += ms;
		}
	};
}

describe('bulk return pool v3 — retrying an add after the entry was moved meanwhile', () => {
	let poolRepo: Fx['poolRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let lockPool: Fx['lockPool'];

	beforeEach(() => {
		({ poolRepo, logRepo, deps, nextOp, openPool, seedLoan, lockPool } =
			createBulkReturnPoolV3Fixture(couch));
	});

	const makeInput = (poolId: string) => ({
		pool_id: poolId,
		returner: { type: 'evacuee' as const, id: EVACUEE },
		items: [
			{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() },
			{ item_id: 'item:wheelchair', qty: '1', operationUlid: nextOp() }
		]
	});

	/** First attempt: the pool is locked at the fence and never clears, so the add times out. */
	async function timedOutAdd(poolId: string, input: ReturnType<typeof makeInput>) {
		const racing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				if (n === 2) await lockPool(poolId);
			}),
			fenceClock: virtualClock()
		};
		await expect(addBulkReturnEntries(input, dist, racing)).rejects.toBeInstanceOf(
			BulkReturnPoolLockTimeoutError
		);
		// The stuck submit is cleared: the pool is OPEN again.
		await poolRepo.mutateCAS(poolId, (cur) => ({ ...cur, lock: null }));
	}

	it('reports a moved entry as relocated, cuts no loan, and still processes the other lines', async () => {
		const poolA = await openPool('Gate A');
		const poolC = await openPool('Gate C');
		await seedLoan(70, { qty: '3' });
		const input = makeInput(poolA._id);
		const cotEntryId = `bulk_return_entry:${input.items[0].operationUlid}`;

		await timedOutAdd(poolA._id, input);
		expect((await logRepo.get(loanId(70)))?.status).toBe('active');

		// Staff move the cot entry A -> C; C is submitted WITHOUT it right after the move's checks.
		let cGets = 0;
		const moveRacing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (_n, id) => {
				if (id !== poolC._id || ++cGets !== 2) return;
				await poolRepo.mutateCAS(poolC._id, (cur) =>
					submitBulkReturnPoolV3(
						cur,
						{
							items_summary: [{ item_id: 'item:wheelchair', qty: '1' }],
							entry_ids: [`bulk_return_entry:${U(996)}`]
						},
						mgr
					)
				);
			})
		};
		const moved = await moveBulkReturnEntry(
			{ entry_id: cotEntryId, to_pool_id: poolC._id },
			dist,
			moveRacing
		);
		expect(moved.late).toBe(true);
		expect(moved.loansApplied).toEqual([]);

		// Retry with the SAME input: pool A is OPEN again, but the entry now lives in C.
		const retry = await addBulkReturnEntries(input, dist, deps);

		const cot = retry.results.find((r) => r.entry._id === cotEntryId)!;
		expect(cot.replayed).toBe(true);
		expect(cot.relocated).toBe('moved');
		expect(cot.relocated_pool_id).toBe(poolC._id);
		expect(cot.late).toBe(false);
		expect(cot.loansApplied).toEqual([]);
		expect(cot.loansSkipped).toEqual([]);
		const loan = await logRepo.get(loanId(70));
		expect(loan?.status).toBe('active');
		expect(loan?.applied_bulk_entry_ids ?? []).toEqual([]);

		// The other line of the batch is still saved normally.
		const wheelchair = retry.results.find((r) => r.entry.item_id === 'item:wheelchair')!;
		expect(wheelchair).toBeDefined();
		expect(wheelchair.late).toBe(false);
		expect(wheelchair.relocated).toBeUndefined();
		expect(wheelchair.entry.pool_id).toBe(poolA._id);
	});

	it('control: a retry with no move applies the loans as before', async () => {
		const poolA = await openPool('Gate A');
		await seedLoan(71, { qty: '3' });
		const input = makeInput(poolA._id);

		await timedOutAdd(poolA._id, input);
		const retry = await addBulkReturnEntries(input, dist, deps);

		const cot = retry.results.find((r) => r.entry.item_id === 'item:cot')!;
		expect(cot.replayed).toBe(true);
		expect(cot.relocated).toBeUndefined();
		expect(cot.late).toBe(false);
		expect(cot.loansApplied).toEqual([loanId(71)]);
		expect((await logRepo.get(loanId(71)))?.applied_bulk_entry_ids).toEqual([cot.entry._id]);
	});
});
