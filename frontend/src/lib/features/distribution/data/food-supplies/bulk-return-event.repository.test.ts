// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import {
	createBulkReturnEntry,
	createBulkReturnEntryMove,
	createBulkReturnEntryVoid,
	deriveEntryMoveId,
	deriveEntryVoidId
} from '../../domain/food-supplies';
import {
	BulkReturnEventRemoteRepository,
	type BulkReturnEventRepository
} from './bulk-return-event.repository';

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

describe('BulkReturnEventRemoteRepository', () => {
	const ctx: AuthorContext = {
		createdBy: 'user:dst1',
		shelterCode: 'SH001',
		roles: ['distribution_staff']
	};
	const P1 = 'bulk_return_pool:01J00000000000000000000031';
	const P2 = 'bulk_return_pool:01J00000000000000000000032';
	const ENTRY_ULID = '01J00000000000000000000041';

	const entry = () =>
		createBulkReturnEntry(
			{ pool_id: P1, item_id: 'item:cot', qty: '3', returner_type: 'unspecified' },
			ctx,
			ENTRY_ULID
		);

	let repo: BulkReturnEventRepository;

	beforeEach(() => {
		couch.reset();
		repo = new BulkReturnEventRemoteRepository('SH001');
	});

	describe('createEntry', () => {
		it('is put-if-absent: a second create of the same id throws ConflictError', async () => {
			const saved = await repo.createEntry(entry());
			expect(saved._id).toBe(`bulk_return_entry:${ENTRY_ULID}`);
			expect(saved._rev).toBeDefined();
			await expect(repo.createEntry(entry())).rejects.toBeInstanceOf(ConflictError);
		});
	});

	describe('getEntry', () => {
		it('returns the entry or null', async () => {
			const saved = await repo.createEntry(entry());
			expect((await repo.getEntry(saved._id))?.qty).toBe('3');
			expect(await repo.getEntry('bulk_return_entry:01J00000000000000000000099')).toBeNull();
		});
	});

	describe('createMove / getMove', () => {
		it('creates move #1 put-if-absent and reads it back', async () => {
			const e = await repo.createEntry(entry());
			const move = createBulkReturnEntryMove(
				{ entry: e, seq: 1, from_pool_id: P1, to_pool_id: P2 },
				ctx
			);
			await repo.createMove(move);
			await expect(repo.createMove(move)).rejects.toBeInstanceOf(ConflictError);
			const read = await repo.getMove(deriveEntryMoveId(e._id, 1));
			expect(read?.to_pool_id).toBe(P2);
			expect(await repo.getMove(deriveEntryMoveId(e._id, 2))).toBeNull();
		});
	});

	describe('createVoid / getVoid', () => {
		it('creates the deterministic void once and reads it back', async () => {
			const e = await repo.createEntry(entry());
			const v = createBulkReturnEntryVoid({ entry: e, pool_id: P1 }, ctx);
			await repo.createVoid(v);
			await expect(repo.createVoid(v)).rejects.toBeInstanceOf(ConflictError);
			expect((await repo.getVoid(deriveEntryVoidId(e._id)))?.entry_id).toBe(e._id);
			expect(await repo.getVoid('bulk_return_entry_void:01J00000000000000000000099')).toBeNull();
		});
	});

	describe('listAll', () => {
		it('returns entries, moves and voids separately (prefixes do not bleed)', async () => {
			const e = await repo.createEntry(entry());
			await repo.createMove(
				createBulkReturnEntryMove({ entry: e, seq: 1, from_pool_id: P1, to_pool_id: P2 }, ctx)
			);
			await repo.createVoid(createBulkReturnEntryVoid({ entry: e, pool_id: P2 }, ctx));
			const all = await repo.listAll();
			expect(all.entries.map((x) => x._id)).toEqual([e._id]);
			expect(all.moves.map((x) => x._id)).toEqual([deriveEntryMoveId(e._id, 1)]);
			expect(all.voids.map((x) => x._id)).toEqual([deriveEntryVoidId(e._id)]);
		});

		it('returns empty lists for an empty database', async () => {
			expect(await repo.listAll()).toEqual({ entries: [], moves: [], voids: [], skipped: [] });
		});

		it('reports invalid docs in skipped instead of throwing', async () => {
			const e = await repo.createEntry(entry());
			const badEntry = 'bulk_return_entry:01J00000000000000000000098';
			const badMove = deriveEntryMoveId(e._id, 1);
			const badVoid = 'bulk_return_entry_void:01J00000000000000000000097';
			couch.store.set(badEntry, { _id: badEntry, type: 'bulk_return_entry' });
			couch.store.set(badMove, { _id: badMove, type: 'bulk_return_entry_move' });
			couch.store.set(badVoid, { _id: badVoid, type: 'bulk_return_entry_void' });

			const all = await repo.listAll();
			expect(all.entries.map((x) => x._id)).toEqual([e._id]);
			expect(all.moves).toEqual([]);
			expect(all.voids).toEqual([]);
			expect(all.skipped.map((s) => s._id).sort()).toEqual([badEntry, badMove, badVoid].sort());
		});
	});

	describe('scoped reads', () => {
		const P3 = 'bulk_return_pool:01J00000000000000000000033';
		const ulidOf = (n: number) => `01J${String(n).padStart(23, '0')}`;
		const entryId = (n: number) => `bulk_return_entry:${ulidOf(n)}`;

		const seedEntry = (n: number, poolId: string) =>
			repo.createEntry(
				createBulkReturnEntry(
					{ pool_id: poolId, item_id: 'item:cot', qty: '3', returner_type: 'unspecified' },
					ctx,
					ulidOf(n)
				)
			);

		const seedMove = async (n: number, seq: number, from: string, to: string) => {
			const e = await repo.getEntry(entryId(n));
			if (!e) throw new Error(`entry ${n} not seeded`);
			return repo.createMove(
				createBulkReturnEntryMove({ entry: e, seq, from_pool_id: from, to_pool_id: to }, ctx)
			);
		};

		const ids = (docs: { _id: string }[]) => docs.map((d) => d._id).sort();

		describe('listForEntry', () => {
			it('returns only that entry with its move chain and void', async () => {
				const a = await seedEntry(1, P1);
				await seedEntry(2, P1);
				await seedMove(1, 1, P1, P2);
				await seedMove(1, 2, P2, P3);
				await seedMove(2, 1, P1, P2);
				await repo.createVoid(createBulkReturnEntryVoid({ entry: a, pool_id: P3 }, ctx));

				const set = await repo.listForEntry(a._id);
				expect(set.entries.map((e) => e._id)).toEqual([a._id]);
				expect(ids(set.moves)).toEqual([deriveEntryMoveId(a._id, 1), deriveEntryMoveId(a._id, 2)]);
				expect(set.voids.map((v) => v._id)).toEqual([deriveEntryVoidId(a._id)]);
				expect(set.skipped).toEqual([]);
			});

			it('returns empty lists for an unknown or malformed entry id', async () => {
				await seedEntry(1, P1);
				const empty = { entries: [], moves: [], voids: [], skipped: [] };
				expect(await repo.listForEntry(entryId(99))).toEqual(empty);
				expect(await repo.listForEntry('nonsense')).toEqual(empty);
			});

			it('is not affected by an invalid doc of another entry', async () => {
				const a = await seedEntry(1, P1);
				couch.store.set(`bulk_return_entry_move:${ulidOf(2)}:0001`, {
					_id: `bulk_return_entry_move:${ulidOf(2)}:0001`,
					type: 'bulk_return_entry_move'
				});
				const set = await repo.listForEntry(a._id);
				expect(set.entries.map((e) => e._id)).toEqual([a._id]);
				expect(set.skipped).toEqual([]);
			});

			it('reports an invalid doc of its own chain in skipped instead of throwing', async () => {
				const a = await seedEntry(1, P1);
				const badId = deriveEntryMoveId(a._id, 1);
				couch.store.set(badId, { _id: badId, type: 'bulk_return_entry_move' });
				const set = await repo.listForEntry(a._id);
				expect(set.moves).toEqual([]);
				expect(set.skipped.map((s) => s._id)).toEqual([badId]);
			});
		});

		describe('listForPool', () => {
			it('unions entries created in the pool and entries moved into it, with whole chains', async () => {
				await seedEntry(1, P1); // created in P1, stays
				await seedEntry(2, P2); // created in P2, moved into P1
				await seedMove(2, 1, P2, P1);
				await seedEntry(3, P1); // created in P1, moved out to P2
				await seedMove(3, 1, P1, P2);
				await seedEntry(4, P3); // unrelated pool
				await seedMove(4, 1, P3, P2);

				const set = await repo.listForPool(P1);
				expect(ids(set.entries)).toEqual([entryId(1), entryId(2), entryId(3)]);
				expect(ids(set.moves)).toEqual([
					deriveEntryMoveId(entryId(2), 1),
					deriveEntryMoveId(entryId(3), 1)
				]);
				expect(set.skipped).toEqual([]);
			});

			it('includes the full chain of an entry that was moved into the pool and on again', async () => {
				await seedEntry(1, P2);
				await seedMove(1, 1, P2, P1);
				await seedMove(1, 2, P1, P3);
				const set = await repo.listForPool(P1);
				expect(ids(set.entries)).toEqual([entryId(1)]);
				expect(set.moves).toHaveLength(2);
			});

			it('includes voids of the scoped entries only', async () => {
				const a = await seedEntry(1, P1);
				const b = await seedEntry(2, P2);
				await repo.createVoid(createBulkReturnEntryVoid({ entry: a, pool_id: P1 }, ctx));
				await repo.createVoid(createBulkReturnEntryVoid({ entry: b, pool_id: P2 }, ctx));
				const set = await repo.listForPool(P1);
				expect(set.voids.map((v) => v.entry_id)).toEqual([a._id]);
			});

			it('pages past the CouchDB default limit and the page size', async () => {
				const count = 205;
				for (let n = 1; n <= count; n++) await seedEntry(n, P1);
				await seedEntry(count + 1, P2);
				const set = await repo.listForPool(P1);
				expect(set.entries).toHaveLength(count);
				expect(new Set(set.entries.map((e) => e._id)).size).toBe(count);
			});

			it('ignores invalid docs of other pools and reports its own in skipped', async () => {
				await seedEntry(1, P1);
				couch.store.set(entryId(2), {
					_id: entryId(2),
					type: 'bulk_return_entry',
					pool_id: P2
				});
				const badOwn = entryId(3);
				couch.store.set(badOwn, { _id: badOwn, type: 'bulk_return_entry', pool_id: P1 });

				const set = await repo.listForPool(P1);
				expect(ids(set.entries)).toEqual([entryId(1)]);
				expect(set.skipped.map((s) => s._id)).toEqual([badOwn]);
			});

			it('returns empty lists for a pool without entries', async () => {
				await seedEntry(1, P2);
				expect(await repo.listForPool(P1)).toEqual({
					entries: [],
					moves: [],
					voids: [],
					skipped: []
				});
			});
		});
	});
});
