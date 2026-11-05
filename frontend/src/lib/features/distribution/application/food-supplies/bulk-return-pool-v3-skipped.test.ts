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

import { deriveEntryMoveId, deriveEntryVoidId } from '../../domain/food-supplies';
import { cancelBulkReturnPool, submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import {
	getBulkReturnPoolOverview,
	getBulkReturnPoolTimeline,
	listBulkReturnPoolClosedLoanRefs,
	listBulkReturnSkippedDocs
} from './bulk-return-pool-v3-read';
import { DistributionDataIntegrityError, WorkflowValidationError } from './errors';
import {
	createBulkReturnPoolV3Fixture,
	EVACUEE,
	loanId,
	mgr,
	OTHER_EVACUEE,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3: malformed docs', () => {
	let poolRepo: Fx['poolRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let add: Fx['add'];
	let entryDocCount: Fx['entryDocCount'];

	beforeEach(() => {
		({ poolRepo, deps, nextOp, openPool, add, entryDocCount } =
			createBulkReturnPoolV3Fixture(couch));
	});

	const putBad = (id: string, doc: Record<string, unknown>) =>
		couch.store.set(id, { _id: id, ...doc });
	const badEntryIn = (n: number, poolId: string) => {
		const id = `bulk_return_entry:${U(n)}`;
		putBad(id, { type: 'bulk_return_entry', pool_id: poolId });
		return id;
	};
	const badLoan = (n: number, recipient: string) => {
		const id = loanId(n);
		putBad(id, { type: 'distribution_log', recipient_id: recipient, is_returnable: true });
		return id;
	};

	/** Opens a pool holding one good unspecified-returner entry. */
	async function poolWithEntry(name = 'Gate A') {
		const pool = await openPool(name);
		const res = await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '2' }]);
		return { pool, entry: res.results[0].entry };
	}

	describe('add entry (loan allocation)', () => {
		it('fails closed when a malformed loan of the returner exists, writing nothing', async () => {
			const pool = await openPool('Gate A');
			const bad = badLoan(50, EVACUEE);
			const attempt = add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await expect(attempt).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expect(attempt).rejects.toMatchObject({ docIds: [bad] });
			expect(entryDocCount()).toBe(0);
		});

		it('is not blocked by a malformed loan of another returner', async () => {
			const pool = await openPool('Gate A');
			badLoan(50, OTHER_EVACUEE);
			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			expect(res.results).toHaveLength(1);
		});

		it('does not read loans for an unspecified returner', async () => {
			const pool = await openPool('Gate A');
			badLoan(50, EVACUEE);
			const res = await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			expect(res.results).toHaveLength(1);
		});
	});

	describe('void', () => {
		it('fails closed on a malformed move in the entry chain', async () => {
			const { entry } = await poolWithEntry();
			const badMove = deriveEntryMoveId(entry._id, 1);
			putBad(badMove, { type: 'bulk_return_entry_move' });
			const attempt = voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps);
			await expect(attempt).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expect(attempt).rejects.toMatchObject({ docIds: [badMove] });
		});

		it('fails closed on a malformed void doc of the entry (it would look un-voided)', async () => {
			const { entry } = await poolWithEntry();
			const badVoid = deriveEntryVoidId(entry._id);
			putBad(badVoid, { type: 'bulk_return_entry_void' });
			await expect(voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps)).rejects.toMatchObject({
				docIds: [badVoid]
			});
		});

		it('is not blocked by a malformed doc of another entry', async () => {
			const { entry } = await poolWithEntry();
			putBad(deriveEntryMoveId(`bulk_return_entry:${U(777)}`, 1), {
				type: 'bulk_return_entry_move'
			});
			const res = await voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps);
			expect(res.replayed).toBe(false);
		});
	});

	describe('move', () => {
		it('fails closed on a malformed move in the entry chain (it would look like a gap)', async () => {
			const { entry } = await poolWithEntry('Gate A');
			const target = await openPool('Gate B');
			const badMove = deriveEntryMoveId(entry._id, 1);
			putBad(badMove, { type: 'bulk_return_entry_move' });
			const attempt = moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				mgr,
				deps
			);
			await expect(attempt).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expect(attempt).rejects.toMatchObject({ docIds: [badMove] });
		});

		it('is not blocked by a malformed entry of another pool', async () => {
			const { entry } = await poolWithEntry('Gate A');
			const target = await openPool('Gate B');
			const other = await openPool('Gate C');
			badEntryIn(888, other._id);
			const res = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				mgr,
				deps
			);
			expect(res.replayed).toBe(false);
		});
	});

	describe('cancel', () => {
		it('fails closed on a malformed entry of the pool and releases its lock', async () => {
			const pool = await openPool('Gate A');
			const bad = badEntryIn(900, pool._id);
			const attempt = cancelBulkReturnPool(pool._id, nextOp(), mgr, deps);
			await expect(attempt).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expect(attempt).rejects.toMatchObject({ docIds: [bad] });
			const after = await poolRepo.get(pool._id);
			expect(after?.status).toBe('OPEN');
			expect(after?.lock).toBeNull();
		});

		it('is not blocked by a malformed entry of another pool', async () => {
			const pool = await openPool('Gate A');
			const other = await openPool('Gate B');
			badEntryIn(900, other._id);
			const cancelled = await cancelBulkReturnPool(pool._id, nextOp(), mgr, deps);
			expect(cancelled.status).toBe('CANCELLED');
		});
	});

	describe('submit', () => {
		it('fails closed on a malformed entry of the pool and releases its lock', async () => {
			const { pool } = await poolWithEntry();
			const bad = badEntryIn(901, pool._id);
			const attempt = submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
			await expect(attempt).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expect(attempt).rejects.toMatchObject({ docIds: [bad] });
			const after = await poolRepo.get(pool._id);
			expect(after?.status).toBe('OPEN');
			expect(after?.lock).toBeNull();
		});

		it('is not blocked by a malformed entry of another pool', async () => {
			const { pool } = await poolWithEntry();
			const other = await openPool('Gate B');
			badEntryIn(901, other._id);
			const submitted = await submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
			expect(submitted.status).toBe('SUBMITTED');
		});
	});

	describe('loadLivePoolEntriesWithLoans (loan-drift reads)', () => {
		it('fails closed when a doc of the pool is malformed', async () => {
			const { pool } = await poolWithEntry();
			const bad = badEntryIn(902, pool._id);
			await expect(listBulkReturnPoolClosedLoanRefs(pool._id, mgr, deps)).rejects.toMatchObject({
				docIds: [bad]
			});
		});
	});

	describe('reads', () => {
		it('the overview no longer throws on malformed event docs and listAll reports them', async () => {
			const { pool } = await poolWithEntry();
			const bad = badEntryIn(903, pool._id);
			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(rows[0].entry_count).toBe(1);
			expect((await deps.eventRepo!.listAll()).skipped.map((s) => s._id)).toEqual([bad]);
		});

		it('the pool timeline reports malformed events of that pool only', async () => {
			const { pool } = await poolWithEntry();
			const other = await openPool('Gate B');
			const bad = badEntryIn(905, pool._id);
			badEntryIn(906, other._id);
			const timeline = await getBulkReturnPoolTimeline(pool._id, mgr, deps);
			expect(timeline.skipped.map((s) => s._id)).toEqual([bad]);
			expect(timeline.events.map((e) => e.kind)).toEqual(['opened', 'entry_added']);
		});

		it('listBulkReturnSkippedDocs gathers malformed pools and events', async () => {
			const { pool } = await poolWithEntry();
			const badEntry = badEntryIn(903, pool._id);
			const badPool = `bulk_return_pool:${U(904)}`;
			putBad(badPool, { type: 'bulk_return_pool', schema_v: 3 });
			badLoan(51, EVACUEE);

			const skipped = await listBulkReturnSkippedDocs({}, mgr, deps);
			expect(skipped.map((s) => s._id).sort()).toEqual([badEntry, badPool].sort());
		});

		it('listBulkReturnSkippedDocs adds the returner loans only when a returner is given', async () => {
			const bad = badLoan(51, EVACUEE);
			badLoan(52, OTHER_EVACUEE);
			const skipped = await listBulkReturnSkippedDocs({ returnerId: EVACUEE }, mgr, deps);
			expect(skipped.map((s) => s._id)).toEqual([bad]);
			expect(await listBulkReturnSkippedDocs({}, mgr, deps)).toEqual([]);
		});

		it('listBulkReturnSkippedDocs rejects a returner id of the wrong kind', async () => {
			await expect(
				listBulkReturnSkippedDocs({ returnerId: 'household:x' }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
		});
	});
});
