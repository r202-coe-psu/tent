import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createBulkReturnEntry } from './bulk-return-entry';
import { createBulkReturnEntryMove } from './bulk-return-entry-move';
import { createBulkReturnEntryVoid } from './bulk-return-entry-void';
import {
	findLateEntries,
	isLateEntry,
	isPoolEmpty,
	poolSnapshotEntryIds,
	resolveBulkReturnEntries,
	summarizePoolItems
} from './bulk-return-pool-summary';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:dst' };
const P1 = 'bulk_return_pool:01J00000000000000000000011';
const P2 = 'bulk_return_pool:01J00000000000000000000012';
const P3 = 'bulk_return_pool:01J00000000000000000000013';

const entryOf = (n: number, pool: string, item: string, qty: string) =>
	createBulkReturnEntry(
		{ pool_id: pool, item_id: item, qty, returner_type: 'unspecified' },
		ctx,
		`01J000000000000000000000${String(n).padStart(2, '0')}`
	);

const e1 = entryOf(1, P1, 'item_master:cot', '5');
const e2 = entryOf(2, P1, 'item_master:cot', '2');
const e3 = entryOf(3, P1, 'item_master:blanket', '7');
const e4 = entryOf(4, P2, 'item_master:cot', '1');
const moveOf = (entry: typeof e1, seq: number, from: string, to: string) =>
	createBulkReturnEntryMove({ entry, seq, from_pool_id: from, to_pool_id: to }, ctx);
const voidOf = (entry: typeof e1, pool: string) =>
	createBulkReturnEntryVoid({ entry, pool_id: pool }, ctx);

describe('summarizePoolItems', () => {
	it('sums qty per item_id for entries recorded into the pool, sorted by item_id', () => {
		expect(summarizePoolItems([e1, e2, e3, e4], [], P1)).toEqual([
			{ item_id: 'item_master:blanket', qty: '7' },
			{ item_id: 'item_master:cot', qty: '7' }
		]);
		expect(summarizePoolItems([e1, e2, e3, e4], [], P2)).toEqual([
			{ item_id: 'item_master:cot', qty: '1' }
		]);
	});

	it('moves an entry out of the source pool and into the target pool', () => {
		const moves = [moveOf(e1, 1, P1, P2)];
		expect(summarizePoolItems([e1, e2, e3, e4], moves, P1)).toEqual([
			{ item_id: 'item_master:blanket', qty: '7' },
			{ item_id: 'item_master:cot', qty: '2' }
		]);
		expect(summarizePoolItems([e1, e2, e3, e4], moves, P2)).toEqual([
			{ item_id: 'item_master:cot', qty: '6' }
		]);
	});

	it('does not double count after a move chain and a move back', () => {
		const moves = [moveOf(e1, 1, P1, P2), moveOf(e1, 2, P2, P3), moveOf(e1, 3, P3, P1)];
		expect(summarizePoolItems([e1], moves, P1)).toEqual([{ item_id: 'item_master:cot', qty: '5' }]);
		expect(summarizePoolItems([e1], moves, P2)).toEqual([]);
		expect(summarizePoolItems([e1], moves, P3)).toEqual([]);
	});

	it('ignores voided entries', () => {
		expect(summarizePoolItems([e1, e2, e3], [], P1, [voidOf(e1, P1)])).toEqual([
			{ item_id: 'item_master:blanket', qty: '7' },
			{ item_id: 'item_master:cot', qty: '2' }
		]);
		expect(summarizePoolItems([e1], [], P1, [voidOf(e1, P1)])).toEqual([]);
	});

	it('returns an empty array for an empty pool', () => {
		expect(summarizePoolItems([e1], [], P3)).toEqual([]);
		expect(summarizePoolItems([], [], P1)).toEqual([]);
	});

	it('throws on a broken chain, a move for an unknown entry, or a duplicate entry', () => {
		expect(() => summarizePoolItems([e1], [moveOf(e1, 2, P1, P2)], P1)).toThrow(/contiguous/);
		expect(() => summarizePoolItems([e1], [moveOf(e2, 1, P1, P2)], P1)).toThrow(/unknown entry/);
		expect(() => summarizePoolItems([e1, e1], [], P1)).toThrow(/Duplicate/);
	});
});

describe('isPoolEmpty', () => {
	it('is false while an entry resolves to the pool and true otherwise', () => {
		expect(isPoolEmpty([e1], [], P1)).toBe(false);
		expect(isPoolEmpty([e1], [], P2)).toBe(true);
		expect(isPoolEmpty([], [], P1)).toBe(true);
	});

	it('is true once the only entry has been moved away, false at the target', () => {
		const moves = [moveOf(e1, 1, P1, P2)];
		expect(isPoolEmpty([e1], moves, P1)).toBe(true);
		expect(isPoolEmpty([e1], moves, P2)).toBe(false);
	});

	it('ignores voided entries: a pool whose entries are all voided is empty', () => {
		expect(isPoolEmpty([e1, e2], [], P1, [voidOf(e1, P1)])).toBe(false);
		expect(isPoolEmpty([e1, e2], [], P1, [voidOf(e1, P1), voidOf(e2, P1)])).toBe(true);
	});
});

describe('resolveBulkReturnEntries', () => {
	it('pairs each entry with its current pool and voided flag', () => {
		const resolved = resolveBulkReturnEntries([e1, e4], [moveOf(e1, 1, P1, P3)]);
		expect(resolved.map((r) => [r.entry._id, r.pool_id, r.voided])).toEqual([
			[e1._id, P3, false],
			[e4._id, P2, false]
		]);
	});

	it('marks a voided entry, resolved against its pool at void time', () => {
		const moves = [moveOf(e1, 1, P1, P2)];
		const resolved = resolveBulkReturnEntries([e1, e4], moves, [voidOf(e1, P2)]);
		expect(resolved.map((r) => [r.entry._id, r.pool_id, r.voided])).toEqual([
			[e1._id, P2, true],
			[e4._id, P2, false]
		]);
	});

	it('throws on a void for an unknown entry', () => {
		expect(() => resolveBulkReturnEntries([e1], [], [voidOf(e2, P1)])).toThrow(/unknown entry/);
	});

	it('throws on more than one void for the same entry', () => {
		expect(() => resolveBulkReturnEntries([e1], [], [voidOf(e1, P1), voidOf(e1, P1)])).toThrow(
			/Multiple voids/
		);
	});

	it('throws when a void item_id or qty differs from the entry', () => {
		const v = voidOf(e1, P1);
		expect(() => resolveBulkReturnEntries([e1], [], [{ ...v, qty: '4' }])).toThrow(/item_id\/qty/);
		expect(() =>
			resolveBulkReturnEntries([e1], [], [{ ...v, item_id: 'item_master:mat' }])
		).toThrow(/item_id\/qty/);
	});

	it('throws when the void pool differs from the resolved pool, including a move after the void', () => {
		expect(() => resolveBulkReturnEntries([e1], [], [voidOf(e1, P2)])).toThrow(/resolves to/);
		// void written while in P1, then a move to P2 lands afterwards
		expect(() => resolveBulkReturnEntries([e1], [moveOf(e1, 1, P1, P2)], [voidOf(e1, P1)])).toThrow(
			/resolves to/
		);
	});

	it('defaults voids to none', () => {
		expect(resolveBulkReturnEntries([e1], []).every((r) => !r.voided)).toBe(true);
	});
});

describe('poolSnapshotEntryIds', () => {
	it('returns the sorted ids of non-voided entries currently in the pool', () => {
		const resolved = resolveBulkReturnEntries(
			[e3, e1, e2, e4],
			[moveOf(e2, 1, P1, P2)],
			[voidOf(e1, P1)]
		);
		expect(poolSnapshotEntryIds(resolved, P1)).toEqual([e3._id]);
		expect(poolSnapshotEntryIds(resolved, P2)).toEqual([e2._id, e4._id]);
		expect(poolSnapshotEntryIds(resolved, P3)).toEqual([]);
	});
});

describe('isLateEntry', () => {
	it('is false while the pool is OPEN', () => {
		expect(isLateEntry(e1._id, { status: 'OPEN' })).toBe(false);
	});

	it('is true for a non-OPEN pool whose fence does not list the entry', () => {
		expect(isLateEntry(e1._id, { status: 'SUBMITTED', entry_ids: [e2._id] })).toBe(true);
		expect(isLateEntry(e1._id, { status: 'RECEIVED', entry_ids: [e2._id] })).toBe(true);
	});

	it('is false for a non-OPEN pool whose fence lists the entry', () => {
		expect(isLateEntry(e1._id, { status: 'SUBMITTED', entry_ids: [e1._id, e2._id] })).toBe(false);
	});

	it('treats an absent entry_ids (CANCELLED) as empty', () => {
		expect(isLateEntry(e1._id, { status: 'CANCELLED' })).toBe(true);
	});
});

describe('findLateEntries', () => {
	const pools = [
		{ _id: P1, status: 'SUBMITTED' as const, entry_ids: [e1._id] },
		{ _id: P2, status: 'OPEN' as const },
		{ _id: P3, status: 'CANCELLED' as const }
	];

	it('returns non-voided entries that resolve into a non-OPEN pool outside its fence', () => {
		const resolved = resolveBulkReturnEntries(
			[e1, e2, e3, e4],
			[moveOf(e3, 1, P1, P3)],
			[voidOf(e2, P1)]
		);
		// e1 in fence, e2 voided, e3 moved to cancelled P3 (late), e4 in OPEN P2.
		expect(findLateEntries(resolved, pools).map((r) => r.entry._id)).toEqual([e3._id]);
	});

	it('flags an entry that landed in a submitted pool after the fence', () => {
		const resolved = resolveBulkReturnEntries([e1, e2], [], []);
		expect(findLateEntries(resolved, pools).map((r) => r.entry._id)).toEqual([e2._id]);
	});

	it('skips entries whose pool is unknown', () => {
		const resolved = resolveBulkReturnEntries([e1, e2], [], []);
		expect(findLateEntries(resolved, [])).toEqual([]);
	});
});
