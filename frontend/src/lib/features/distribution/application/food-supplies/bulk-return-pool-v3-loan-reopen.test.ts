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
	buildPoolTimeline,
	createBulkReturnEntry,
	createBulkReturnLoanReopen,
	deriveLoanReopenId
} from '../../domain/food-supplies';
import { submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { reopenBulkReturnEntryLoans } from './bulk-return-pool-v3-loan-reopen';
import {
	applyMissedBulkReturnLoanRefs,
	listBulkReturnPoolMissedLoanRefs
} from './bulk-return-pool-v3-missed-loans';
import {
	BulkReturnLoanReopenError,
	BulkReturnPoolStateError,
	WorkflowAuthorizationError,
	WorkflowValidationError
} from './errors';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	fullInput,
	loanId,
	mgr,
	reg,
	sm,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 — reopen the loans of an entry (CR-193 §35)', () => {
	let poolRepo: Fx['poolRepo'];
	let eventRepo: Fx['eventRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let add: Fx['add'];
	let ledgerKeys: Fx['ledgerKeys'];
	let receive: Fx['receive'];

	beforeEach(() => {
		({ poolRepo, eventRepo, logRepo, deps, nextOp, openPool, seedLoan, add, ledgerKeys, receive } =
			createBulkReturnPoolV3Fixture(couch));
	});

	const reopenKeys = () =>
		[...couch.store.keys()].filter((k) => k.startsWith('bulk_return_loan_reopen:'));

	/** Open pool, one loan (cot x3) with a 2-cot drop-off applied, then submitted (or received). */
	async function closedPoolWithAppliedLoan(loanNo: number, receiveIt = false) {
		const pool = await openPool('Gate A');
		await seedLoan(loanNo, { qty: '3' });
		await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '2' }]);
		const entry = (await eventRepo.listForPool(pool._id)).entries[0];
		let closed = await submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
		if (receiveIt) {
			await receive(pool._id, fullInput(closed));
			closed = (await poolRepo.get(pool._id))!;
		}
		expect((await logRepo.get(loanId(loanNo)))?.applied_bulk_entry_ids).toEqual([entry._id]);
		return { pool: closed, entry };
	}

	for (const receiveIt of [false, true]) {
		it(`reopens the loan of an entry in a ${receiveIt ? 'RECEIVED' : 'SUBMITTED'} pool without touching pool or stock`, async () => {
			const { pool, entry } = await closedPoolWithAppliedLoan(80, receiveIt);
			const poolBefore = await poolRepo.get(pool._id);
			const ledgerBefore = ledgerKeys();

			const res = await reopenBulkReturnEntryLoans(
				{ entry_id: entry._id, reason: '  wrong returner  ' },
				sm,
				deps
			);

			expect(res).toMatchObject({
				replayed: false,
				loansReopened: [loanId(80)],
				loansSkipped: []
			});
			expect(res.reopen).toMatchObject({
				_id: deriveLoanReopenId(entry._id),
				entry_id: entry._id,
				pool_id: pool._id,
				reason: 'wrong returner',
				loan_ids: [loanId(80)],
				created_by: 'user:sm1'
			});
			expect(reopenKeys()).toEqual([deriveLoanReopenId(entry._id)]);
			const loan = await logRepo.get(loanId(80));
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned).toBe('0');
			expect(loan?.applied_bulk_entry_ids ?? []).toEqual([]);

			const poolAfter = await poolRepo.get(pool._id);
			expect(poolAfter).toEqual(poolBefore);
			expect(poolAfter?.status).toBe(receiveIt ? 'RECEIVED' : 'SUBMITTED');
			expect(ledgerKeys()).toEqual(ledgerBefore);
			expect((await eventRepo.getEntry(entry._id))?._rev).toBe(entry._rev);
		});
	}

	it('rejects a blank reason and writes nothing', async () => {
		const { entry } = await closedPoolWithAppliedLoan(81);

		const err = await reopenBulkReturnEntryLoans(
			{ entry_id: entry._id, reason: '   ' },
			sm,
			deps
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BulkReturnLoanReopenError);
		expect((err as BulkReturnLoanReopenError).reason).toBe('reason_required');

		expect(reopenKeys()).toEqual([]);
		expect((await logRepo.get(loanId(81)))?.applied_bulk_entry_ids).toEqual([entry._id]);
	});

	it('lets warehouse_staff of the shelter reopen the loan of an entry (FR-35.2)', async () => {
		const { entry } = await closedPoolWithAppliedLoan(87);

		const res = await reopenBulkReturnEntryLoans({ entry_id: entry._id, reason: 'x' }, mgr, deps);

		expect(res).toMatchObject({ replayed: false, loansReopened: [loanId(87)] });
		expect(reopenKeys()).toEqual([deriveLoanReopenId(entry._id)]);
		expect((await logRepo.get(loanId(87)))?.applied_bulk_entry_ids ?? []).not.toContain(entry._id);
	});

	const coordinator = {
		createdBy: 'user:coord1',
		shelterCode: 'SH001',
		roles: ['shelter:SH001', 'SH001:supply_coordinator']
	};

	it.each([
		['distribution_staff', dist],
		['registration_staff', reg],
		['supply_coordinator', coordinator]
	])('rejects %s and writes nothing', async (_label, ctx) => {
		const { entry } = await closedPoolWithAppliedLoan(82);

		await expect(
			reopenBulkReturnEntryLoans({ entry_id: entry._id, reason: 'x' }, ctx, deps)
		).rejects.toBeInstanceOf(WorkflowAuthorizationError);

		expect(reopenKeys()).toEqual([]);
		expect((await logRepo.get(loanId(82)))?.applied_bulk_entry_ids).toEqual([entry._id]);
	});

	it('rejects an OPEN pool with reason not_submitted', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(83);
		await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '1' }]);
		const entry = (await eventRepo.listForPool(pool._id)).entries[0];

		const err = await reopenBulkReturnEntryLoans(
			{ entry_id: entry._id, reason: 'x' },
			sm,
			deps
		).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(BulkReturnPoolStateError);
		expect((err as BulkReturnPoolStateError).reason).toBe('not_submitted');
		expect(reopenKeys()).toEqual([]);
	});

	it('rejects an entry that is not in the pool snapshot (late entry)', async () => {
		const { pool } = await closedPoolWithAppliedLoan(84);
		// A late entry: written into the already submitted pool after its snapshot.
		const late = await eventRepo.createEntry(
			createBulkReturnEntry(
				{ pool_id: pool._id, item_id: 'item:cot', qty: '1', returner_type: 'unspecified' },
				mgr,
				U(777)
			)
		);
		expect(pool.entry_ids ?? []).not.toContain(late._id);

		const err = await reopenBulkReturnEntryLoans(
			{ entry_id: late._id, reason: 'x' },
			sm,
			deps
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BulkReturnLoanReopenError);
		expect((err as BulkReturnLoanReopenError).reason).toBe('not_in_snapshot');
		expect(reopenKeys()).toEqual([]);
	});

	it('rejects an entry with no applied loan ref', async () => {
		const pool = await openPool('Gate A');
		await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
		await submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
		const entry = (await eventRepo.listForPool(pool._id)).entries[0];

		const err = await reopenBulkReturnEntryLoans(
			{ entry_id: entry._id, reason: 'x' },
			sm,
			deps
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BulkReturnLoanReopenError);
		expect((err as BulkReturnLoanReopenError).reason).toBe('no_applied_loan');
		expect(reopenKeys()).toEqual([]);
	});

	it.each(['lost', 'waived'] as const)(
		'rejects BEFORE writing when an applied loan was meanwhile cleared as %s',
		async (clearReason) => {
			const no = clearReason === 'lost' ? 86 : 92;
			const { entry } = await closedPoolWithAppliedLoan(no);
			await logRepo.recordClear(
				loanId(no),
				{ clear_reason: clearReason, notes: 'closed at the desk' },
				mgr
			);

			const err = await reopenBulkReturnEntryLoans(
				{ entry_id: entry._id, reason: 'x' },
				sm,
				deps
			).catch((e: unknown) => e);

			expect(err).toBeInstanceOf(BulkReturnLoanReopenError);
			expect(err).toMatchObject({ reason: 'loan_not_revertable', loanStatus: clearReason });
			expect((err as Error).message).toMatch(/cannot be reopened/);
			expect(reopenKeys()).toEqual([]);
		}
	);

	it('is idempotent: a second call replays and reverts nothing more', async () => {
		const { entry } = await closedPoolWithAppliedLoan(87);
		const first = await reopenBulkReturnEntryLoans({ entry_id: entry._id, reason: 'x' }, sm, deps);
		const loanAfterFirst = await logRepo.get(loanId(87));

		const again = await reopenBulkReturnEntryLoans(
			{ entry_id: entry._id, reason: 'another reason' },
			sm,
			deps
		);

		expect(again.replayed).toBe(true);
		expect(again.loansReopened).toEqual([]);
		expect(again.loansSkipped).toEqual([]);
		expect(again.reopen.reason).toBe(first.reopen.reason);
		expect(await logRepo.get(loanId(87))).toEqual(loanAfterFirst);
		expect(reopenKeys()).toHaveLength(1);
	});

	it('concurrent calls write one doc and revert the loan exactly once', async () => {
		const { entry } = await closedPoolWithAppliedLoan(88);
		const input = { entry_id: entry._id, reason: 'x' };

		const settled = await Promise.allSettled([
			reopenBulkReturnEntryLoans(input, sm, deps),
			reopenBulkReturnEntryLoans(input, sm, deps)
		]);

		const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
		expect(ok.length).toBeGreaterThanOrEqual(1);
		expect(reopenKeys()).toHaveLength(1);
		expect(ok.reduce((n, r) => n + r.loansReopened.length, 0)).toBe(1);
		const loan = await logRepo.get(loanId(88));
		expect(loan?.status).toBe('active');
		expect(loan?.qty_returned).toBe('0');
		expect(loan?.applied_bulk_entry_ids ?? []).toEqual([]);
	});

	it('replay reports (does not throw on) a loan that is no longer revertable', async () => {
		const { entry } = await closedPoolWithAppliedLoan(89);
		// Reopen doc exists (e.g. a crash after the write) but the loan moved on meanwhile.
		await eventRepo.createLoanReopen(
			createBulkReturnLoanReopen(
				{ entry, pool_id: entry.pool_id, reason: 'x', loan_ids: [loanId(89)] },
				sm
			)
		);
		await logRepo.recordClear(
			loanId(89),
			{ clear_reason: 'lost', notes: 'lost in the flood' },
			mgr
		);

		const res = await reopenBulkReturnEntryLoans({ entry_id: entry._id, reason: 'x' }, sm, deps);

		expect(res.replayed).toBe(true);
		expect(res.loansReopened).toEqual([]);
		expect(res.loansSkipped).toEqual([
			{ distribution_log_id: loanId(89), reason: 'not_revertable' }
		]);
	});

	it('excludes the reopened entry from the missed-loan repair', async () => {
		const { pool, entry } = await closedPoolWithAppliedLoan(90);
		await reopenBulkReturnEntryLoans({ entry_id: entry._id, reason: 'x' }, sm, deps);

		// The reverted loan would look like a missed ref without the exclusion.
		expect(await listBulkReturnPoolMissedLoanRefs(pool._id, dist, deps)).toEqual([]);
		await expect(
			applyMissedBulkReturnLoanRefs({ entry_id: entry._id, pool_id: pool._id }, dist, deps)
		).rejects.toBeInstanceOf(WorkflowValidationError);
		expect((await logRepo.get(loanId(90)))?.applied_bulk_entry_ids ?? []).toEqual([]);
	});

	it('shows a loan_reopened event with the reason on the pool timeline', async () => {
		const { pool, entry } = await closedPoolWithAppliedLoan(91);
		await reopenBulkReturnEntryLoans({ entry_id: entry._id, reason: 'wrong returner' }, sm, deps);

		const events = await eventRepo.listForPool(pool._id);
		const timeline = buildPoolTimeline(
			(await poolRepo.get(pool._id))!,
			events,
			new Map([[entry._id, pool._id]])
		);

		expect(timeline.find((e) => e.kind === 'loan_reopened')).toMatchObject({
			entry_id: entry._id,
			notes: 'wrong returner',
			by: 'user:sm1'
		});
	});

	it('does not reopen an unknown entry', async () => {
		const err = await reopenBulkReturnEntryLoans(
			{ entry_id: `bulk_return_entry:${U(995)}`, reason: 'x' },
			sm,
			deps
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BulkReturnLoanReopenError);
		expect((err as BulkReturnLoanReopenError).reason).toBe('entry_not_found');
	});
});
