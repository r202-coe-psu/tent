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
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { reopenBulkReturnEntryLoans } from './bulk-return-pool-v3-loan-reopen';
import { applyRefToLoan } from './bulk-return-pool-v3-shared';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	mgr,
	racingPoolRepo,
	sm,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

/** Virtual clock for the fence: `sleep` only advances time (the lock never clears). */
function stuckClock() {
	let t = 0;
	return {
		now: () => t,
		sleep: async (ms: number) => {
			t += ms;
		}
	};
}

describe('bulk return pool v3 — a replayed add never re-cuts reopened loans (CR-193 §35)', () => {
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

	/**
	 * The add times out on the fence (lock never clears) while a submit snapshots the entry, then the
	 * submit completes WITH the entry in entry_ids. No loan was cut by the timed-out add.
	 */
	async function timedOutAddCountedBySubmit(loanNo: number) {
		const pool = await openPool('Gate A');
		await seedLoan(loanNo, { qty: '3' });
		let snapshot!: { items_summary: ReturnType<typeof summarizePoolItems>; entry_ids: string[] };
		const racing = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async (n) => {
				if (n !== 2) return;
				await lockPool(pool._id);
				const events = await eventRepo.listForPool(pool._id);
				snapshot = {
					items_summary: summarizePoolItems(events.entries, events.moves, pool._id, events.voids),
					entry_ids: poolSnapshotEntryIds(
						resolveBulkReturnEntries(events.entries, events.moves, events.voids),
						pool._id
					)
				};
			}),
			fenceClock: stuckClock()
		};
		const input = {
			pool_id: pool._id,
			returner: { type: 'evacuee' as const, id: EVACUEE },
			items: [{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() }]
		};

		// #950 (CR-193 §37.3 A2): the fence timeout no longer throws; the written line is loan_pending.
		const missed = await addBulkReturnEntries(input, dist, racing);
		expect(missed.results).toHaveLength(1);
		expect(missed.results[0]).toMatchObject({ loan_pending: true, loansApplied: [] });
		await poolRepo.mutateCAS(pool._id, (cur) => submitBulkReturnPoolV3(cur, snapshot, mgr));

		const final = (await poolRepo.get(pool._id))!;
		const entry = (await eventRepo.listForPool(pool._id)).entries[0];
		expect(final.status).toBe('SUBMITTED');
		expect(final.entry_ids).toContain(entry._id);
		expect((await logRepo.get(loanId(loanNo)))?.status).toBe('active');
		return { input, entry };
	}

	it('retry after a manager reopened the loans reports loans_reopened and cuts nothing', async () => {
		const { input, entry } = await timedOutAddCountedBySubmit(70);
		// The loan is cut (e.g. by the missed-loan repair), then the manager reopens it.
		await applyRefToLoan(logRepo, entry, entry.loan_refs[0], dist);
		expect((await logRepo.get(loanId(70)))?.applied_bulk_entry_ids).toEqual([entry._id]);
		await reopenBulkReturnEntryLoans({ entry_id: entry._id, reason: 'wrong returner' }, sm, deps);

		const retry = await addBulkReturnEntries(input, dist, deps);

		expect(retry.results).toHaveLength(1);
		expect(retry.results[0]).toMatchObject({
			replayed: true,
			late: false,
			loans_reopened: true,
			loansApplied: [],
			loansSkipped: []
		});
		const loan = await logRepo.get(loanId(70));
		expect(loan?.status).toBe('active');
		expect(loan?.qty_returned).toBe('0');
		expect(loan?.applied_bulk_entry_ids ?? []).not.toContain(entry._id);
	});

	it('control: without a reopen doc the retry applies the loan (in_snapshot path)', async () => {
		const { input, entry } = await timedOutAddCountedBySubmit(71);

		const retry = await addBulkReturnEntries(input, dist, deps);

		expect(retry.results[0].loans_reopened).toBeUndefined();
		expect(retry.results[0].late).toBe(false);
		expect(retry.results[0].loansApplied).toEqual([loanId(71)]);
		expect((await logRepo.get(loanId(71)))?.applied_bulk_entry_ids).toEqual([entry._id]);
	});
});
