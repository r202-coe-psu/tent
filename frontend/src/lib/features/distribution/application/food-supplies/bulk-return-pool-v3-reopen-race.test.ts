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
	deriveLoanReopenId,
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import type {
	BulkReturnEventRepository,
	DistributionLogRepository
} from '../../data/food-supplies';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { reopenBulkReturnEntryLoans } from './bulk-return-pool-v3-loan-reopen';
import { applyMissedBulkReturnLoanRefs } from './bulk-return-pool-v3-missed-loans';
import { applyRefToLoan } from './bulk-return-pool-v3-shared';
import { WorkflowValidationError } from './errors';
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

describe('bulk return pool v3 — reopen vs concurrent loan apply (CR-193 §35)', () => {
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

	/** Log repo whose n-th `mutateLogCAS` first runs `before(n)` (another actor's step). */
	function logRepoBeforeCas(
		real: DistributionLogRepository,
		before: (n: number) => Promise<void>
	): DistributionLogRepository {
		let n = 0;
		return {
			create: (i, c) => real.create(i, c),
			get: (id) => real.get(id),
			getMany: (ids) => real.getMany(ids),
			list: (f) => real.list(f),
			listWithSkipped: (f) => real.listWithSkipped(f),
			mutateLogCAS: async (id, m, o) => {
				n++;
				await before(n);
				return real.mutateLogCAS(id, m, o);
			},
			recordReturn: (id, i, c) => real.recordReturn(id, i, c),
			recordClear: (id, i, c) => real.recordClear(id, i, c),
			recordVoid: (id, c, n2) => real.recordVoid(id, c, n2)
		};
	}

	/** Event repo whose `createLoanReopen` first runs `before()` (reopen has read the loans already). */
	function eventRepoBeforeReopenCreate(
		real: BulkReturnEventRepository,
		before: () => Promise<void>
	): BulkReturnEventRepository {
		return {
			createEntry: (e) => real.createEntry(e),
			getEntry: (id) => real.getEntry(id),
			getEntriesByIds: (ids) => real.getEntriesByIds(ids),
			createMove: (m) => real.createMove(m),
			getMove: (id) => real.getMove(id),
			createVoid: (v) => real.createVoid(v),
			getVoid: (id) => real.getVoid(id),
			createLoanReopen: async (r) => {
				await before();
				return real.createLoanReopen(r);
			},
			getLoanReopen: (id) => real.getLoanReopen(id),
			getLoanReopensByIds: (ids) => real.getLoanReopensByIds(ids),
			listAll: () => real.listAll(),
			listForEntry: (id) => real.listForEntry(id),
			listForPool: (id) => real.listForPool(id)
		};
	}

	/**
	 * Two loans (cot x3 each) and a 5-cot drop-off allocated 3 + 2 whose add timed out on the fence
	 * (loans untouched); the pool is then submitted WITH the entry in its snapshot.
	 */
	async function submittedPoolWithMissedEntry(firstLoanNo: number) {
		const pool = await openPool('Gate A');
		await seedLoan(firstLoanNo, { qty: '3' });
		await seedLoan(firstLoanNo + 1, { qty: '3' });
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
				}
			}
		};
		const input = {
			pool_id: pool._id,
			returner: { type: 'evacuee' as const, id: EVACUEE },
			items: [{ item_id: 'item:cot', qty: '5', operationUlid: nextOp() }]
		};
		// #950 (CR-193 §37.3 A2): the fence timeout no longer throws; the written line is loan_pending.
		const missed = await addBulkReturnEntries(input, dist, racing);
		expect(missed.results).toHaveLength(1);
		expect(missed.results[0]).toMatchObject({ loan_pending: true, loansApplied: [] });
		const events = await eventRepo.listForPool(pool._id);
		const entry = events.entries[0];
		expect(entry.loan_refs.map((r) => r.distribution_log_id)).toEqual([
			loanId(firstLoanNo),
			loanId(firstLoanNo + 1)
		]);
		await poolRepo.mutateCAS(pool._id, (cur) =>
			submitBulkReturnPoolV3(
				cur,
				{
					items_summary: summarizePoolItems(events.entries, events.moves, pool._id, events.voids),
					entry_ids: poolSnapshotEntryIds(
						resolveBulkReturnEntries(events.entries, events.moves, events.voids),
						pool._id
					)
				},
				mgr
			)
		);
		expect((await poolRepo.get(pool._id))?.status).toBe('SUBMITTED');
		return { pool, entry, input };
	}

	const reopenNow = (entryId: string, d = deps) =>
		reopenBulkReturnEntryLoans({ entry_id: entryId, reason: 'wrong returner' }, sm, d);

	async function expectNoLoanCut(entryId: string, loanNos: number[]) {
		for (const no of loanNos) {
			const loan = await logRepo.get(loanId(no));
			expect(loan?.applied_bulk_entry_ids ?? []).not.toContain(entryId);
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned).toBe('0');
		}
	}

	it('missed-loans apply: a reopen landing between the pre-check and the 2nd CAS is not cut again', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(90);
		let reopened = false;
		const racing = {
			...deps,
			logRepo: logRepoBeforeCas(logRepo, async (n) => {
				// Loan 90 is cut by now; the reopen reads only that one, then apply cuts loan 91.
				if (n !== 2 || reopened) return;
				reopened = true;
				await reopenNow(entry._id);
			})
		};

		const err = await applyMissedBulkReturnLoanRefs(
			{ entry_id: entry._id, pool_id: pool._id },
			dist,
			racing
		).catch((e: unknown) => e);

		expect(reopened).toBe(true);
		expect(err).toBeInstanceOf(WorkflowValidationError);
		expect((err as Error).message).toMatch(/reopened on purpose/);
		expect(await eventRepo.getLoanReopen(deriveLoanReopenId(entry._id))).not.toBeNull();
		await expectNoLoanCut(entry._id, [90, 91]);
	});

	it('reopen final sweep: an apply CAS that lands before the reopen doc exists (and misses it) is reverted', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(92);
		// Loan 92 is cut (so there is something to reopen); loan 93 is still missed.
		await applyRefToLoan(logRepo, entry, entry.loan_refs[0], dist);
		let applyResult: Awaited<ReturnType<typeof applyMissedBulkReturnLoanRefs>> | undefined;
		const racing = {
			...deps,
			// Runs after the reopen read the loans, before it writes its doc: the apply sees no doc.
			eventRepo: eventRepoBeforeReopenCreate(eventRepo, async () => {
				applyResult = await applyMissedBulkReturnLoanRefs(
					{ entry_id: entry._id, pool_id: pool._id },
					dist,
					deps
				);
			})
		};

		const res = await reopenNow(entry._id, racing);

		expect(applyResult?.loansApplied).toEqual([loanId(93)]); // the apply won its own check
		expect(res.replayed).toBe(false);
		expect([...res.loansReopened].sort()).toEqual([loanId(92), loanId(93)]);
		expect(res.loansSkipped).toEqual([]);
		await expectNoLoanCut(entry._id, [92, 93]);
	});

	it('reopen final sweep reports a swept loan that is no longer revertable as not_revertable', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(94);
		await applyRefToLoan(logRepo, entry, entry.loan_refs[0], dist);
		const racing = {
			...deps,
			eventRepo: eventRepoBeforeReopenCreate(eventRepo, async () => {
				await applyMissedBulkReturnLoanRefs({ entry_id: entry._id, pool_id: pool._id }, dist, deps);
				// Loan 95 moves on after the concurrent apply cut it: it cannot be reverted any more.
				await logRepo.recordClear(
					loanId(95),
					{ clear_reason: 'lost', notes: 'lost in the flood' },
					mgr
				);
			})
		};

		const res = await reopenNow(entry._id, racing);

		expect(res.loansReopened).toEqual([loanId(94)]);
		expect(res.loansSkipped).toEqual([
			{ distribution_log_id: loanId(95), reason: 'not_revertable' }
		]);
	});

	it('add-entry replay: a reopen landing between the replay pre-check and the 2nd CAS is not cut again', async () => {
		const { entry, input } = await submittedPoolWithMissedEntry(96);
		let reopened = false;
		const racing = {
			...deps,
			logRepo: logRepoBeforeCas(logRepo, async (n) => {
				if (n !== 2 || reopened) return;
				reopened = true;
				await reopenNow(entry._id);
			})
		};

		const res = await addBulkReturnEntries(input, dist, racing);

		expect(reopened).toBe(true);
		expect(res.results).toHaveLength(1);
		expect(res.results[0]).toMatchObject({
			replayed: true,
			late: false,
			loansApplied: [],
			loansSkipped: [],
			loans_reopened: true
		});
		expect(await eventRepo.getLoanReopen(deriveLoanReopenId(entry._id))).not.toBeNull();
		await expectNoLoanCut(entry._id, [96, 97]);
	});

	it('add-entry fresh entry counted by a submit: a reopen landing between its two loan CASes is reverted', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(110, { qty: '3' });
		await seedLoan(111, { qty: '3' });
		let submitted = false;
		let reopened = false;
		const racing = {
			...deps,
			// The first read of the pool after the entry landed is the fence: a submit counts it first.
			poolRepo: racingPoolRepo(poolRepo, async (_n, id) => {
				if (submitted || id !== pool._id) return;
				const events = await eventRepo.listForPool(pool._id);
				if (events.entries.length === 0) return;
				submitted = true;
				await poolRepo.mutateCAS(pool._id, (cur) =>
					submitBulkReturnPoolV3(
						cur,
						{
							items_summary: summarizePoolItems(
								events.entries,
								events.moves,
								pool._id,
								events.voids
							),
							entry_ids: poolSnapshotEntryIds(
								resolveBulkReturnEntries(events.entries, events.moves, events.voids),
								pool._id
							)
						},
						mgr
					)
				);
			}),
			logRepo: logRepoBeforeCas(logRepo, async (n) => {
				// Loan 110 is cut by now (so there is something to reopen); loan 111 is not yet.
				if (n !== 2 || reopened) return;
				reopened = true;
				const events = await eventRepo.listForPool(pool._id);
				await reopenNow(events.entries[0]._id);
			})
		};

		const res = await addBulkReturnEntries(
			{
				pool_id: pool._id,
				returner: { type: 'evacuee' as const, id: EVACUEE },
				items: [
					{ item_id: 'item:cot', qty: '5', operationUlid: nextOp() },
					{ item_id: 'item:wheelchair', qty: '1', operationUlid: nextOp() }
				]
			},
			dist,
			racing
		);

		expect(submitted).toBe(true);
		expect(reopened).toBe(true);
		// Fence `in_snapshot`: the first line stops the call, the second item is never written.
		expect(res.results).toHaveLength(1);
		expect(res.results[0]).toMatchObject({
			replayed: false,
			late: false,
			loansApplied: [],
			loansSkipped: [],
			loans_reopened: true
		});
		expect((await eventRepo.listForPool(pool._id)).entries).toHaveLength(1);
		const entryId = res.results[0].entry._id;
		expect(await eventRepo.getLoanReopen(deriveLoanReopenId(entryId))).not.toBeNull();
		await expectNoLoanCut(entryId, [110, 111]);
	});

	it('add-entry A2 replay on the original pool: an entry reopened earlier is not cut again', async () => {
		const { entry, input } = await submittedPoolWithMissedEntry(98);
		await applyRefToLoan(logRepo, entry, entry.loan_refs[0], dist);
		await reopenNow(entry._id);
		// Loan 98 was cut then reopened (qty_returned back to its reopened value); loan 99 untouched.
		const snapshot = async () =>
			Promise.all([98, 99].map(async (no) => (await logRepo.get(loanId(no)))!));
		const afterReopen = await snapshot();
		for (const loan of afterReopen) {
			expect(loan.applied_bulk_entry_ids ?? []).not.toContain(entry._id);
			expect(loan.status).toBe('active');
			expect(Number(loan.qty_returned ?? '0')).toBe(0);
		}

		// Same operation ULID retried: the entry exists, the replay is bound to its original pool.
		const res = await addBulkReturnEntries(input, dist, deps);

		expect(res.results).toHaveLength(1);
		expect(res.results[0]).toMatchObject({
			replayed: true,
			late: false,
			loansApplied: [],
			loansSkipped: [],
			loans_reopened: true
		});
		const afterReplay = await snapshot();
		expect(afterReplay).toEqual(afterReopen);
		for (const loan of afterReplay) {
			expect(loan.applied_bulk_entry_ids ?? []).not.toContain(entry._id);
			expect(loan.status).toBe('active');
		}
	});
});
