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

import { ConflictError } from '$lib/utils/errors';
import {
	createBulkReturnEntryVoid,
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import { cancelBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import {
	applyMissedBulkReturnLoanRefs,
	listBulkReturnPoolMissedLoanRefs
} from './bulk-return-pool-v3-missed-loans';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import { BulkReturnPoolStateError, WorkflowValidationError } from './errors';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	mgr,
	racingPoolRepo,
	reg,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 — missed loan refs (fence timeout repair)', () => {
	let poolRepo: Fx['poolRepo'];
	let eventRepo: Fx['eventRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let lockPool: Fx['lockPool'];
	let add: Fx['add'];
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
			lockPool,
			add,
			driftingLogRepo
		} = createBulkReturnPoolV3Fixture(couch));
	});

	/**
	 * Reproduces the stuck add: the pool is locked, the fence times out, the entry is written but
	 * its loans are untouched. The pool stays locked.
	 */
	async function lockedPoolWithMissedEntry(loanNo: number) {
		const pool = await openPool('Gate A');
		await seedLoan(loanNo, { qty: '3' });
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
		const added = await addBulkReturnEntries(
			{
				pool_id: pool._id,
				returner: { type: 'evacuee', id: EVACUEE },
				items: [{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() }]
			},
			dist,
			racing
		);
		expect(added.results.map((r) => r.loan_pending)).toEqual([true]);

		const events = await eventRepo.listForPool(pool._id);
		const entry = events.entries[0];
		expect((await logRepo.get(loanId(loanNo)))?.applied_bulk_entry_ids ?? []).toEqual([]);
		return { pool, entry };
	}

	/** The stuck submit is gone: the lock is released and the pool is OPEN again. */
	async function openPoolWithMissedEntry(loanNo: number) {
		const { pool, entry } = await lockedPoolWithMissedEntry(loanNo);
		await poolRepo.mutateCAS(pool._id, (cur) => ({ ...cur, lock: null }));
		return { pool, entry };
	}

	/** The pool is submitted WITH the entry in its snapshot. */
	async function submittedPoolWithMissedEntry(loanNo: number) {
		const { pool, entry } = await lockedPoolWithMissedEntry(loanNo);
		const events = await eventRepo.listForPool(pool._id);
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
		return { pool, entry };
	}

	it('lists the missed ref of a SUBMITTED pool whose entry never cut its loan', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(70);

		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([
			{ entry_id: entry._id, distribution_log_id: loanId(70), qty: '2' }
		]);
	});

	it('returns [] for an OPEN pool whose entries all cut their loans', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(71);
		await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '1' }]);

		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
	});

	it('lists the missed ref of an OPEN pool entry whose loan was not cut', async () => {
		const { pool, entry } = await openPoolWithMissedEntry(80);

		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([
			{ entry_id: entry._id, distribution_log_id: loanId(80), qty: '2' }
		]);
	});

	it('apply cuts the loan of an OPEN pool entry once, then the list is empty', async () => {
		const { pool, entry } = await openPoolWithMissedEntry(81);
		const input = { entry_id: entry._id, pool_id: pool._id };

		const res = await applyMissedBulkReturnLoanRefs(input, dist, deps);
		const again = await applyMissedBulkReturnLoanRefs(input, dist, deps);

		expect(res).toEqual({ loansApplied: [loanId(81)], loansSkipped: [] });
		expect(again).toEqual({ loansApplied: [], loansSkipped: [] });
		const loan = await logRepo.get(loanId(81));
		expect(loan?.qty_returned).toBe('2');
		expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
	});

	it('neither lists nor applies the ref of a voided entry in an OPEN pool', async () => {
		const { pool, entry } = await openPoolWithMissedEntry(82);
		await voidBulkReturnEntry({ entry_id: entry._id }, dist, deps);

		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
		await expect(
			applyMissedBulkReturnLoanRefs({ entry_id: entry._id, pool_id: pool._id }, dist, deps)
		).rejects.toBeInstanceOf(WorkflowValidationError);
		const loan = await logRepo.get(loanId(82));
		expect(loan?.applied_bulk_entry_ids ?? []).toEqual([]);
		expect(loan?.qty_returned ?? '0').toBe('0');
	});

	it('does not cut the loan when the entry is voided right before the repair writes', async () => {
		const { pool, entry } = await openPoolWithMissedEntry(83);
		const racing = {
			...deps,
			logRepo: {
				...driftingLogRepo(async () => {}),
				mutateLogCAS: async (...args: Parameters<typeof logRepo.mutateLogCAS>) => {
					await eventRepo.createVoid(createBulkReturnEntryVoid({ entry, pool_id: pool._id }, dist));
					return logRepo.mutateLogCAS(...args);
				}
			}
		};

		const res = await applyMissedBulkReturnLoanRefs(
			{ entry_id: entry._id, pool_id: pool._id },
			dist,
			racing
		);

		expect(res).toEqual({ loansApplied: [], loansSkipped: [], voided: true });
		expect((await logRepo.get(loanId(83)))?.applied_bulk_entry_ids ?? []).toEqual([]);
	});

	it('lists nothing for a locked OPEN pool (CR-193 §37.3) and rejects its apply as locked', async () => {
		const { pool, entry } = await lockedPoolWithMissedEntry(84);

		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
		const err = await applyMissedBulkReturnLoanRefs(
			{ entry_id: entry._id, pool_id: pool._id },
			dist,
			deps
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BulkReturnPoolStateError);
		expect((err as BulkReturnPoolStateError).reason).toBe('locked');
		expect((await logRepo.get(loanId(84)))?.applied_bulk_entry_ids ?? []).toEqual([]);
	});

	it('apply rejects an entry that moved out of the OPEN pool', async () => {
		const { pool, entry } = await openPoolWithMissedEntry(85);
		const target = await openPool('Gate B');
		await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: target._id }, dist, deps);

		await expect(
			applyMissedBulkReturnLoanRefs({ entry_id: entry._id, pool_id: pool._id }, dist, deps)
		).rejects.toBeInstanceOf(WorkflowValidationError);
	});

	it('returns [] for a normal, applied entry in a SUBMITTED pool', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(72);
		await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '1' }]);
		const events = await eventRepo.listForPool(pool._id);
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

		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
	});

	it('does not list a loan cleared as lost (it is a closed ref, not a missed one)', async () => {
		const { pool } = await submittedPoolWithMissedEntry(73);
		await logRepo.recordClear(
			loanId(73),
			{ clear_reason: 'lost', notes: 'lost in the flood' },
			mgr
		);

		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
	});

	it('apply cuts the loan, then the list is empty', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(74);

		const res = await applyMissedBulkReturnLoanRefs(
			{ entry_id: entry._id, pool_id: pool._id },
			dist,
			deps
		);

		expect(res).toEqual({ loansApplied: [loanId(74)], loansSkipped: [] });
		const loan = await logRepo.get(loanId(74));
		expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
		expect(loan?.status).toBe('partially_returned');
		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
	});

	it('apply is idempotent', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(75);
		const input = { entry_id: entry._id, pool_id: pool._id };
		await applyMissedBulkReturnLoanRefs(input, dist, deps);

		const again = await applyMissedBulkReturnLoanRefs(input, dist, deps);

		expect(again).toEqual({ loansApplied: [], loansSkipped: [] });
		expect((await logRepo.get(loanId(75)))?.applied_bulk_entry_ids).toEqual([entry._id]);
	});

	it('concurrent repair presses never double-apply the loan', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(79);
		const input = { entry_id: entry._id, pool_id: pool._id };

		const settled = await Promise.allSettled([
			applyMissedBulkReturnLoanRefs(input, dist, deps),
			applyMissedBulkReturnLoanRefs(input, dist, deps),
			applyMissedBulkReturnLoanRefs(input, mgr, deps)
		]);

		for (const s of settled) {
			if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(ConflictError);
		}
		const applied = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
		expect(applied.reduce((n, r) => n + r.loansApplied.length, 0)).toBe(1);
		expect(applied.filter((r) => r.loansApplied.length === 1)).toHaveLength(1);
		for (const r of applied) expect(r.loansApplied.length).toBeLessThanOrEqual(1);

		const loan = await logRepo.get(loanId(79));
		expect(loan?.qty_returned).toBe('2');
		expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
		expect(loan?.status).toBe('partially_returned');
	});

	it('apply skips a drifted loan instead of partially applying it', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(76);
		await logRepo.recordClear(
			loanId(76),
			{ clear_reason: 'lost', notes: 'lost in the flood' },
			mgr
		);

		const res = await applyMissedBulkReturnLoanRefs(
			{ entry_id: entry._id, pool_id: pool._id },
			dist,
			deps
		);

		expect(res.loansApplied).toEqual([]);
		expect(res.loansSkipped).toMatchObject([{ distribution_log_id: loanId(76), reason: 'closed' }]);
	});

	it('apply rejects an entry that is not in the pool snapshot', async () => {
		const { pool } = await submittedPoolWithMissedEntry(77);

		await expect(
			applyMissedBulkReturnLoanRefs(
				{ entry_id: `bulk_return_entry:${U(995)}`, pool_id: pool._id },
				dist,
				deps
			)
		).rejects.toThrow(/not part of/);
	});

	it('apply rejects an entry that is not live in an OPEN pool', async () => {
		const pool = await openPool('Gate A');

		await expect(
			applyMissedBulkReturnLoanRefs(
				{ entry_id: `bulk_return_entry:${U(996)}`, pool_id: pool._id },
				dist,
				deps
			)
		).rejects.toBeInstanceOf(WorkflowValidationError);
	});

	it('apply rejects a CANCELLED pool', async () => {
		const pool = await openPool('Gate A');
		await cancelBulkReturnPool(pool._id, nextOp(), mgr, deps);

		const err = await applyMissedBulkReturnLoanRefs(
			{ entry_id: `bulk_return_entry:${U(996)}`, pool_id: pool._id },
			dist,
			deps
		).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(BulkReturnPoolStateError);
		expect((err as BulkReturnPoolStateError).reason).toBe('closed');
	});

	it('apply rejects registration_staff', async () => {
		const { pool, entry } = await submittedPoolWithMissedEntry(78);

		await expect(
			applyMissedBulkReturnLoanRefs({ entry_id: entry._id, pool_id: pool._id }, reg, deps)
		).rejects.toThrow();
		expect((await logRepo.get(loanId(78)))?.applied_bulk_entry_ids ?? []).toEqual([]);
	});
});
