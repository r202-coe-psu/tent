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
			expect(await repo.listAll()).toEqual({ entries: [], moves: [], voids: [] });
		});
	});
});
