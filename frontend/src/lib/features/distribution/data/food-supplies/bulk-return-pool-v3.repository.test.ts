// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import { createBulkReturnPoolV3 } from '../../domain/food-supplies';
import {
	BulkReturnPoolV3RemoteRepository,
	type BulkReturnPoolV3Repository
} from './bulk-return-pool-v3.repository';

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

describe('BulkReturnPoolV3RemoteRepository', () => {
	const ctx: AuthorContext = {
		createdBy: 'user:wh1',
		shelterCode: 'SH001',
		roles: ['warehouse_staff']
	};
	const ID1 = '01J00000000000000000000021';
	const ID2 = '01J00000000000000000000022';

	let repo: BulkReturnPoolV3Repository;

	beforeEach(() => {
		couch.reset();
		repo = new BulkReturnPoolV3RemoteRepository('SH001');
	});

	describe('create', () => {
		it('persists an OPEN pool put-if-absent and throws ConflictError on a second create', async () => {
			const created = await repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1));
			expect(created.status).toBe('OPEN');
			expect(created._rev).toBeDefined();
			await expect(
				repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1))
			).rejects.toBeInstanceOf(ConflictError);
		});

		it('rejects an invalid doc', async () => {
			const pool = createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1);
			await expect(repo.create({ ...pool, name: '' })).rejects.toThrow();
		});
	});

	describe('get', () => {
		it('returns the pool or null', async () => {
			const created = await repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1));
			expect((await repo.get(created._id))?.name).toBe('Gate A');
			expect(await repo.get(`bulk_return_pool:${ID2}`)).toBeNull();
		});

		it('returns null for a legacy v1/v2 pool', async () => {
			const legacyId = `bulk_return_pool:${ID2}`;
			couch.store.set(legacyId, {
				_id: legacyId,
				_rev: '1-x',
				type: 'bulk_return_pool',
				schema_v: 2
			});
			expect(await repo.get(legacyId)).toBeNull();
		});
	});

	describe('list', () => {
		it('lists v3 pools only and ignores legacy pools', async () => {
			await repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1));
			const legacyId = `bulk_return_pool:${ID2}`;
			couch.store.set(legacyId, {
				_id: legacyId,
				_rev: '1-x',
				type: 'bulk_return_pool',
				schema_v: 1
			});
			const pools = await repo.list();
			expect(pools.map((p) => p._id)).toEqual([`bulk_return_pool:${ID1}`]);
		});

		it('skips a malformed v3 pool instead of throwing and reports it in listWithSkipped', async () => {
			await repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1));
			const badId = `bulk_return_pool:${ID2}`;
			couch.store.set(badId, {
				_id: badId,
				_rev: '1-x',
				type: 'bulk_return_pool',
				schema_v: 3
			});
			expect((await repo.list()).map((p) => p._id)).toEqual([`bulk_return_pool:${ID1}`]);
			const found = await repo.listWithSkipped();
			expect(found.items.map((p) => p._id)).toEqual([`bulk_return_pool:${ID1}`]);
			expect(found.skipped.map((s) => s._id)).toEqual([badId]);
		});

		it('does not report a legacy pool as skipped', async () => {
			const legacyId = `bulk_return_pool:${ID2}`;
			couch.store.set(legacyId, {
				_id: legacyId,
				_rev: '1-x',
				type: 'bulk_return_pool',
				schema_v: 1
			});
			expect((await repo.listWithSkipped()).skipped).toEqual([]);
		});
	});

	describe('update', () => {
		it('writes with CAS and rejects a stale _rev', async () => {
			const created = await repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1));
			const updated = await repo.update({ ...created, name: 'Gate B' });
			expect(updated.name).toBe('Gate B');
			expect(updated._rev).not.toBe(created._rev);
			await expect(repo.update({ ...created, name: 'Gate C' })).rejects.toBeInstanceOf(
				ConflictError
			);
		});

		it('requires a _rev', async () => {
			const pool = createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1);
			await expect(repo.update(pool)).rejects.toThrow(/_rev/);
		});
	});

	describe('mutateCAS', () => {
		it('applies the mutation and validates the transition', async () => {
			const created = await repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1));
			const updated = await repo.mutateCAS(created._id, (cur) => ({ ...cur, name: 'Gate B' }));
			expect(updated.name).toBe('Gate B');
			await expect(
				repo.mutateCAS(created._id, (cur) => ({ ...cur, status: 'RECEIVED' }))
			).rejects.toThrow();
		});

		it('does not write when the mutator returns the current doc', async () => {
			const created = await repo.create(createBulkReturnPoolV3({ name: 'Gate A' }, ctx, ID1));
			const same = await repo.mutateCAS(created._id, (cur) => cur);
			expect(same._rev).toBe(created._rev);
		});

		it('throws NotFoundError for a missing pool', async () => {
			await expect(repo.mutateCAS(`bulk_return_pool:${ID2}`, (cur) => cur)).rejects.toThrow(
				/Not found/
			);
		});
	});
});
