// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { now } from '$lib/db/model';

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

import { createBulkReturnEntry } from '../../domain/food-supplies';
import {
	cancelBulkReturnPool,
	openBulkReturnPool,
	submitBulkReturnPool,
	updateBulkReturnPoolHeader
} from './bulk-return-pool-v3-lifecycle';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import { getBulkReturnPoolOverview } from './bulk-return-pool-v3-read';
import {
	BulkReturnPoolEmptyError,
	BulkReturnPoolNameTakenError,
	BulkReturnPoolNotEmptyError,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowAuthorizationError,
	WorkflowValidationError
} from './errors';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	fullInput,
	mgr,
	reg,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 workflows', () => {
	let poolRepo: Fx['poolRepo'];
	let eventRepo: Fx['eventRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let add: Fx['add'];
	let lockPool: Fx['lockPool'];
	let ledgerKeys: Fx['ledgerKeys'];
	let balanceOf: Fx['balanceOf'];
	let submittedPool: Fx['submittedPool'];
	let receive: Fx['receive'];

	beforeEach(() => {
		({
			poolRepo,
			eventRepo,
			deps,
			nextOp,
			openPool,
			add,
			lockPool,
			ledgerKeys,
			balanceOf,
			submittedPool,
			receive
		} = createBulkReturnPoolV3Fixture(couch));
	});

	describe('openBulkReturnPool', () => {
		it('opens an empty pool with a location snapshot and no quantity', async () => {
			const pool = await openBulkReturnPool(
				{ name: ' Gate A ', storagePoint: { id: 'sp1', name: 'Zone 1' }, notes: 'n' },
				nextOp(),
				mgr,
				deps
			);
			expect(pool.status).toBe('OPEN');
			expect(pool.name).toBe('Gate A');
			expect(pool.location_storage_point_id).toBe('sp1');
			expect(pool.location_storage_zone).toBe('Zone 1');
			expect(pool.notes).toBe('n');
			expect(pool.items_summary).toBeUndefined();
		});

		it('rejects a duplicate name among OPEN pools', async () => {
			await openPool('Gate A');
			await expect(openPool('  gate   a ')).rejects.toBeInstanceOf(BulkReturnPoolNameTakenError);
		});

		it('is idempotent for the same operationUlid', async () => {
			const op = nextOp();
			const first = await openBulkReturnPool({ name: 'Gate A' }, op, mgr, deps);
			const second = await openBulkReturnPool({ name: 'Gate A' }, op, mgr, deps);
			expect(second._id).toBe(first._id);
			expect((await poolRepo.list()).length).toBe(1);
		});

		it('reports a collision when the operationUlid was used for another name', async () => {
			const op = nextOp();
			await openBulkReturnPool({ name: 'Gate A' }, op, mgr, deps);
			await expect(openBulkReturnPool({ name: 'Gate B' }, op, mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);
		});
	});

	describe('updateBulkReturnPoolHeader', () => {
		it('renames, sets and clears location and notes', async () => {
			const pool = await openPool('Gate A');
			const set = await updateBulkReturnPoolHeader(
				pool._id,
				{ name: 'Gate B', storagePoint: { id: 'sp1', name: 'Zone 1' }, notes: 'x' },
				mgr,
				deps
			);
			expect(set.name).toBe('Gate B');
			expect(set.location_storage_zone).toBe('Zone 1');
			const cleared = await updateBulkReturnPoolHeader(
				pool._id,
				{ storagePoint: null, notes: null },
				mgr,
				deps
			);
			expect(cleared.location_storage_point_id).toBeUndefined();
			expect(cleared.location_storage_zone).toBeUndefined();
			expect(cleared.notes).toBeUndefined();
			expect(cleared.name).toBe('Gate B');
		});

		it('rejects a duplicate name of another OPEN pool but allows keeping its own', async () => {
			const a = await openPool('Gate A');
			await openPool('Gate B');
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'gate b' }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolNameTakenError);
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'GATE A' }, mgr, deps)
			).resolves.toBeDefined();
		});

		it('rejects a locked pool', async () => {
			const a = await openPool('Gate A');
			await lockPool(a._id);
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'X' }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
		});
	});

	describe('cancelBulkReturnPool', () => {
		it('refuses a non-empty pool, clears the lock, then cancels after the entries are moved out', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);

			await expect(cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolNotEmptyError
			);
			const stillOpen = await poolRepo.get(a._id);
			expect(stillOpen?.status).toBe('OPEN');
			expect(stillOpen?.lock ?? null).toBeNull();

			await moveBulkReturnEntry({ entry_id: results[0].entry._id, to_pool_id: b._id }, mgr, deps);

			const op = nextOp();
			const cancelled = await cancelBulkReturnPool(a._id, op, mgr, deps);
			expect(cancelled.status).toBe('CANCELLED');
			expect(cancelled.cancelled_by).toBe('user:wh1');
			expect(cancelled.lock ?? null).toBeNull();
			expect(await poolRepo.get(a._id)).not.toBeNull();

			// Idempotent: same op and a different op both return the cancelled pool.
			expect((await cancelBulkReturnPool(a._id, op, mgr, deps)).status).toBe('CANCELLED');
			expect((await cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');

			// Hidden from the default overview, visible on request.
			expect((await getBulkReturnPoolOverview({}, mgr, deps)).map((r) => r.pool._id)).toEqual([
				b._id
			]);
			expect(
				(await getBulkReturnPoolOverview({ includeCancelled: true }, mgr, deps)).map(
					(r) => r.pool._id
				)
			).toHaveLength(2);
		});

		it('treats a voided entry as empty', async () => {
			const a = await openPool('Gate A');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await voidBulkReturnEntry({ entry_id: results[0].entry._id }, mgr, deps);
			expect((await cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');
		});

		it('continues a replay holding its own CANCEL lock and rejects another operation lock', async () => {
			const a = await openPool('Gate A');
			const op = nextOp();
			await poolRepo.mutateCAS(a._id, (cur) => ({
				...cur,
				lock: { op: 'CANCEL', op_id: op, locked_at: now(), locked_by: 'user:wh1' }
			}));
			await expect(cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);
			expect((await cancelBulkReturnPool(a._id, op, mgr, deps)).status).toBe('CANCELLED');
		});

		it('rejects a missing pool', async () => {
			await expect(
				cancelBulkReturnPool(`bulk_return_pool:${U(78)}`, nextOp(), mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
		});
	});

	describe('submitBulkReturnPool', () => {
		it('snapshots items_summary and entry_ids, clears the lock and writes no stock', async () => {
			const pool = await openPool('Gate A');
			const first = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:wheelchair', qty: '1' },
				{ item_id: 'item:cot', qty: '2' }
			]);
			const second = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '3' }
			]);
			const entryIds = [...first.results, ...second.results].map((r) => r.entry._id).sort();

			const submitted = await submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
			expect(submitted.status).toBe('SUBMITTED');
			expect(submitted.items_summary).toEqual([
				{ item_id: 'item:cot', qty: '5' },
				{ item_id: 'item:wheelchair', qty: '1' }
			]);
			expect(submitted.entry_ids).toEqual(entryIds);
			expect(submitted.lock ?? null).toBeNull();
			expect(submitted.submitted_by).toBe('user:wh1');
			expect(submitted.submitted_at).toBeDefined();
			expect(await poolRepo.get(pool._id)).toMatchObject({ status: 'SUBMITTED' });

			expect(ledgerKeys()).toEqual([]);
			expect(await balanceOf()).toEqual({});
		});

		it('is idempotent: the same operation, another operation and a replay holding its own lock', async () => {
			const pool = await openPool('Gate A');
			await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);

			const op = nextOp();
			const first = await submitBulkReturnPool(pool._id, op, mgr, deps);
			expect((await submitBulkReturnPool(pool._id, op, mgr, deps)).submitted_at).toBe(
				first.submitted_at
			);
			expect((await submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).status).toBe('SUBMITTED');

			const other = await openPool('Gate B');
			await add(other._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			const ownOp = nextOp();
			await poolRepo.mutateCAS(other._id, (cur) => ({
				...cur,
				lock: { op: 'SUBMIT', op_id: ownOp, locked_at: now(), locked_by: 'user:wh1' }
			}));
			expect((await submitBulkReturnPool(other._id, ownOp, mgr, deps)).status).toBe('SUBMITTED');
		});

		it('rejects a pool locked by another SUBMIT or CANCEL operation', async () => {
			const a = await openPool('Gate A');
			await add(a._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			await lockPool(a._id);
			await expect(submitBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);

			const b = await openPool('Gate B');
			await add(b._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			await poolRepo.mutateCAS(b._id, (cur) => ({
				...cur,
				lock: { op: 'CANCEL', op_id: U(901), locked_at: now(), locked_by: 'user:x' }
			}));
			await expect(submitBulkReturnPool(b._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);
			expect((await poolRepo.get(b._id))?.status).toBe('OPEN');
		});

		it('refuses an empty pool, releases its lock and leaves the pool OPEN', async () => {
			const pool = await openPool('Gate A');
			await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolEmptyError
			);
			const after = await poolRepo.get(pool._id);
			expect(after?.status).toBe('OPEN');
			expect(after?.lock ?? null).toBeNull();
			// The pool can still be cancelled, and the empty-pool message says so.
			await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toThrow(/cancel/);
		});

		it('treats a pool whose only entry was voided or moved out as empty', async () => {
			const voidedPool = await openPool('Gate A');
			const movedPool = await openPool('Gate B');
			const target = await openPool('Gate C');
			const a = await add(voidedPool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const b = await add(movedPool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await voidBulkReturnEntry({ entry_id: a.results[0].entry._id }, mgr, deps);
			await moveBulkReturnEntry(
				{ entry_id: b.results[0].entry._id, to_pool_id: target._id },
				mgr,
				deps
			);

			for (const pool of [voidedPool, movedPool]) {
				await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
					BulkReturnPoolEmptyError
				);
				const after = await poolRepo.get(pool._id);
				expect(after?.status).toBe('OPEN');
				expect(after?.lock ?? null).toBeNull();
			}
			// The entry that moved in counts for its new pool.
			const moved = await submitBulkReturnPool(target._id, nextOp(), mgr, deps);
			expect(moved.entry_ids).toEqual([b.results[0].entry._id]);
		});

		it('excludes an entry that lands after the submit and reports it late', async () => {
			const pool = await submittedPool();
			const lateEntry = await eventRepo.createEntry(
				createBulkReturnEntry(
					{
						pool_id: pool._id,
						item_id: 'item:cot',
						qty: '4',
						returner_type: 'unspecified',
						loan_refs: []
					},
					mgr,
					nextOp()
				)
			);

			const stored = await poolRepo.get(pool._id);
			expect(stored?.items_summary).toEqual(pool.items_summary);
			expect(stored?.entry_ids).toEqual(pool.entry_ids);
			expect(stored?.entry_ids).not.toContain(lateEntry._id);

			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			const row = rows.find((r) => r.pool._id === pool._id);
			expect(row?.late_entries.map((r) => r.entry._id)).toEqual([lateEntry._id]);
		});

		it('rejects a missing, CANCELLED or RECEIVED pool', async () => {
			await expect(
				submitBulkReturnPool(`bulk_return_pool:${U(81)}`, nextOp(), mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			const cancelled = await openPool('Gate A');
			await cancelBulkReturnPool(cancelled._id, nextOp(), mgr, deps);
			await expect(submitBulkReturnPool(cancelled._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolStateError
			);

			const pool = await submittedPool('Gate B');
			await receive(pool._id, fullInput(pool));
			// RECEIVED is past SUBMITTED: not an idempotent replay.
			await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolStateError
			);
		});
	});

	describe('authorization and endpoint', () => {
		it('denies registration_staff every mutating workflow', async () => {
			const pool = await openPool('Gate A');
			const { results } = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entryId = results[0].entry._id;
			const denied = WorkflowAuthorizationError;
			await expect(openPool('Gate Z', reg)).rejects.toBeInstanceOf(denied);
			await expect(
				updateBulkReturnPoolHeader(pool._id, { name: 'Q' }, reg, deps)
			).rejects.toBeInstanceOf(denied);
			await expect(cancelBulkReturnPool(pool._id, nextOp(), reg, deps)).rejects.toBeInstanceOf(
				denied
			);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }], reg)
			).rejects.toBeInstanceOf(denied);
			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: pool._id }, reg, deps)
			).rejects.toBeInstanceOf(denied);
			await expect(voidBulkReturnEntry({ entry_id: entryId }, reg, deps)).rejects.toBeInstanceOf(
				denied
			);
		});

		it('lets distribution_staff add, move and void but not open, update or cancel', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await expect(openPool('Gate Z', dist)).rejects.toBeInstanceOf(WorkflowAuthorizationError);
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'Q' }, dist, deps)
			).rejects.toBeInstanceOf(WorkflowAuthorizationError);
			await expect(cancelBulkReturnPool(a._id, nextOp(), dist, deps)).rejects.toBeInstanceOf(
				WorkflowAuthorizationError
			);

			const { results } = await add(
				a._id,
				{ type: 'unspecified' },
				[{ item_id: 'item:cot', qty: '1' }],
				dist
			);
			const entryId = results[0].entry._id;
			await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, dist, deps);
			const voided = await voidBulkReturnEntry({ entry_id: entryId }, dist, deps);
			expect(voided.replayed).toBe(false);
		});

		it('rejects writes when the endpoint is not central or not writable, before any other check', async () => {
			const edge = { ...deps, endpointStore: { active: 'edge', isWritable: true } };
			const offline = { ...deps, endpointStore: { active: 'central', isWritable: false } };
			await expect(openBulkReturnPool({ name: 'X' }, nextOp(), reg, edge)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			await expect(
				openBulkReturnPool({ name: 'X' }, nextOp(), mgr, offline)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				addBulkReturnEntries(
					{ pool_id: `bulk_return_pool:${U(79)}`, returner: { type: 'unspecified' }, items: [] },
					mgr,
					edge
				)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				cancelBulkReturnPool(`bulk_return_pool:${U(79)}`, nextOp(), mgr, edge)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				voidBulkReturnEntry({ entry_id: `bulk_return_entry:${U(80)}` }, mgr, offline)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				moveBulkReturnEntry(
					{ entry_id: `bulk_return_entry:${U(80)}`, to_pool_id: `bulk_return_pool:${U(79)}` },
					mgr,
					offline
				)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				updateBulkReturnPoolHeader(`bulk_return_pool:${U(79)}`, { name: 'Q' }, mgr, edge)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(couch.store.size).toBe(0);
		});
	});
});
