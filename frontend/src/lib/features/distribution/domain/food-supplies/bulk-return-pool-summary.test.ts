import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createBulkReturnEntry } from './bulk-return-entry';
import { createBulkReturnEntryMove } from './bulk-return-entry-move';
import { createBulkReturnEntryVoid } from './bulk-return-entry-void';
import {
	buildSnapshotPins,
	findSnapshotConflicts,
	findLateEntries,
	findUnresolvedBulkReturnRefs,
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

	it('throws on a broken chain or a duplicate entry', () => {
		expect(() =>
			summarizePoolItems([e1], [moveOf(e1, 1, P1, P2), moveOf(e1, 1, P1, P3)], P1)
		).toThrow(/contiguous/);
		expect(() => summarizePoolItems([e1, e1], [], P1)).toThrow(/Duplicate/);
	});

	it('ignores a move for an unknown entry', () => {
		expect(summarizePoolItems([e1], [moveOf(e2, 1, P1, P2)], P1)).toEqual([
			{ item_id: 'item_master:cot', qty: '5' }
		]);
	});
});

describe('findUnresolvedBulkReturnRefs', () => {
	it('lists an orphan move with its from/to pools', () => {
		expect(findUnresolvedBulkReturnRefs([e1], [moveOf(e2, 1, P1, P2)])).toEqual([
			{ kind: 'move', entry_id: e2._id, pool_ids: [P1, P2] }
		]);
	});

	it('lists an orphan void with its pool', () => {
		expect(findUnresolvedBulkReturnRefs([e1], [], [voidOf(e2, P1)])).toEqual([
			{ kind: 'void', entry_id: e2._id, pool_ids: [P1] }
		]);
	});

	it('orders by entry_id, then kind, then seq', () => {
		const refs = findUnresolvedBulkReturnRefs(
			[],
			[moveOf(e2, 2, P2, P3), moveOf(e2, 1, P1, P2), moveOf(e1, 1, P1, P3)],
			[voidOf(e2, P3)]
		);
		expect(refs.map((r) => [r.entry_id, r.kind, r.pool_ids])).toEqual([
			[e1._id, 'move', [P1, P3]],
			[e2._id, 'move', [P1, P2]],
			[e2._id, 'move', [P2, P3]],
			[e2._id, 'void', [P3]]
		]);
	});

	it('returns [] when every move/void has its entry', () => {
		expect(findUnresolvedBulkReturnRefs([e1], [moveOf(e1, 1, P1, P2)], [voidOf(e1, P2)])).toEqual(
			[]
		);
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

	it('skips a void for an unknown entry without affecting known entries', () => {
		const resolved = resolveBulkReturnEntries([e1], [], [voidOf(e2, P1)]);
		expect(resolved.map((r) => [r.entry._id, r.pool_id, r.voided])).toEqual([[e1._id, P1, false]]);
	});

	it('throws on a duplicate entry', () => {
		expect(() => resolveBulkReturnEntries([e1, e1], [])).toThrow(/Duplicate/);
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

describe('pending sync (move chain gap)', () => {
	// e1 starts in P1; seq 2 (P2 -> P3) replicated but seq 1 (P1 -> P2) has not.
	const gapMoves = () => [moveOf(e1, 2, P2, P3)];

	it('omits the pending entry from resolveBulkReturnEntries', () => {
		const resolved = resolveBulkReturnEntries([e1, e2], gapMoves());
		expect(resolved.map((r) => r.entry._id)).toEqual([e2._id]);
	});

	it('excludes it from every pool: summary, snapshot ids and emptiness', () => {
		for (const pool of [P1, P2, P3]) {
			const items = summarizePoolItems([e1], gapMoves(), pool);
			expect(items).toEqual([]);
			expect(isPoolEmpty([e1], gapMoves(), pool)).toBe(true);
			expect(poolSnapshotEntryIds(resolveBulkReturnEntries([e1], gapMoves()), pool)).toEqual([]);
		}
		expect(summarizePoolItems([e1, e2], gapMoves(), P1)).toEqual([
			{ item_id: 'item_master:cot', qty: '2' }
		]);
	});

	it('is never a late entry while pending', () => {
		const pools = [{ _id: P3, status: 'SUBMITTED' as const, entry_ids: [] }];
		expect(findLateEntries(resolveBulkReturnEntries([e1], gapMoves()), pools)).toEqual([]);
	});

	it('surfaces one move_gap ref with the original and move pools', () => {
		expect(findUnresolvedBulkReturnRefs([e1, e2], gapMoves())).toEqual([
			{ kind: 'move_gap', entry_id: e1._id, pool_ids: [P1, P2, P3], missing_seqs: [1] }
		]);
	});

	it('adds a void pool_id to the move_gap ref, deduped', () => {
		const refs = findUnresolvedBulkReturnRefs([e1], gapMoves(), [voidOf(e1, P3)]);
		expect(refs).toEqual([
			{ kind: 'move_gap', entry_id: e1._id, pool_ids: [P1, P2, P3], missing_seqs: [1] }
		]);
		const other = findUnresolvedBulkReturnRefs([e1], gapMoves(), [
			voidOf(e1, 'bulk_return_pool:01J00000000000000000000014')
		]);
		expect(other[0].pool_ids).toEqual([P1, P2, P3, 'bulk_return_pool:01J00000000000000000000014']);
	});

	it('keeps orphan refs and orders move_gap by entry_id, then kind', () => {
		const refs = findUnresolvedBulkReturnRefs(
			[e1],
			[moveOf(e1, 2, P2, P3), moveOf(e2, 1, P1, P2)],
			[voidOf(e2, P2)]
		);
		expect(refs.map((r) => [r.entry_id, r.kind])).toEqual([
			[e1._id, 'move_gap'],
			[e2._id, 'move'],
			[e2._id, 'void']
		]);
	});

	it('self-heals once the missing move arrives', () => {
		const moves = [...gapMoves(), moveOf(e1, 1, P1, P2)];
		expect(findUnresolvedBulkReturnRefs([e1], moves)).toEqual([]);
		const resolved = resolveBulkReturnEntries([e1], moves);
		expect(resolved.map((r) => [r.entry._id, r.pool_id])).toEqual([[e1._id, P3]]);
		expect(summarizePoolItems([e1], moves, P3)).toEqual([{ item_id: 'item_master:cot', qty: '5' }]);
	});

	it('still throws for a pending entry whose void qty mismatches', () => {
		const v = voidOf(e1, P3);
		expect(() => resolveBulkReturnEntries([e1], gapMoves(), [{ ...v, qty: '4' }])).toThrow(
			/item_id\/qty/
		);
	});

	it('skips the void pool check for a pending entry (omitted, not voided)', () => {
		expect(resolveBulkReturnEntries([e1], gapMoves(), [voidOf(e1, P1)])).toEqual([]);
	});

	it('still throws for a move after a void when there is no gap', () => {
		expect(() => resolveBulkReturnEntries([e1], [moveOf(e1, 1, P1, P2)], [voidOf(e1, P1)])).toThrow(
			/resolves to/
		);
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

describe('buildSnapshotPins', () => {
	it('pins the entry_ids of non-OPEN pools only', () => {
		const pins = buildSnapshotPins([
			{ _id: P1, status: 'SUBMITTED', entry_ids: [e1._id, e2._id] },
			{ _id: P2, status: 'OPEN', entry_ids: [e3._id] },
			{ _id: P3, status: 'CANCELLED' }
		]);
		expect([...pins]).toEqual([
			[e1._id, P1],
			[e2._id, P1]
		]);
	});

	it('keeps the earliest submitted_at when an id is in two pools', () => {
		const pins = buildSnapshotPins([
			{
				_id: P2,
				status: 'SUBMITTED',
				entry_ids: [e1._id],
				submitted_at: '2026-01-02T00:00:00.000Z'
			},
			{
				_id: P1,
				status: 'RECEIVED',
				entry_ids: [e1._id],
				submitted_at: '2026-01-01T00:00:00.000Z'
			}
		]);
		expect(pins.get(e1._id)).toBe(P1);
	});
});

describe('pinned resolveBulkReturnEntries', () => {
	const pins = new Map([[e1._id, P1]]);

	it('ignores a post-snapshot void: stays in the pinned pool, not voided, flagged', () => {
		const resolved = resolveBulkReturnEntries([e1, e2], [], [voidOf(e1, P1)], pins);
		expect(resolved.map((r) => [r.entry._id, r.pool_id, r.voided, r.snapshot_conflict])).toEqual([
			[e1._id, P1, false, 'void'],
			[e2._id, P1, false, undefined]
		]);
		expect(summarizePoolItems([e1, e2], [], P1, [voidOf(e1, P1)], pins)).toEqual([
			{ item_id: 'item_master:cot', qty: '7' }
		]);
		expect(isPoolEmpty([e1], [], P1, [voidOf(e1, P1)], pins)).toBe(false);
	});

	it('ignores a post-snapshot move out: counted only in the pinned pool, flagged', () => {
		const moves = [moveOf(e1, 1, P1, P2)];
		const resolved = resolveBulkReturnEntries([e1, e4], moves, [], pins);
		expect(resolved[0]).toMatchObject({ pool_id: P1, voided: false, snapshot_conflict: 'move' });
		expect(summarizePoolItems([e1, e4], moves, P2, [], pins)).toEqual([
			{ item_id: 'item_master:cot', qty: '1' }
		]);
		expect(poolSnapshotEntryIds(resolved, P2)).toEqual([e4._id]);
		expect(isPoolEmpty([e1], moves, P2, [], pins)).toBe(true);
	});

	it('reports void when both a move and a void exist, and still validates the void pool', () => {
		const moves = [moveOf(e1, 1, P1, P2)];
		const resolved = resolveBulkReturnEntries([e1], moves, [voidOf(e1, P2)], pins);
		expect(resolved[0].snapshot_conflict).toBe('void');
		expect(() => resolveBulkReturnEntries([e1], moves, [voidOf(e1, P3)], pins)).toThrow(/is for/);
	});

	it('has no conflict for a pinned entry that was never moved or voided', () => {
		const resolved = resolveBulkReturnEntries([e1], [], [], pins);
		expect(resolved[0]).toEqual({ entry: e1, pool_id: P1, voided: false });
		expect(findSnapshotConflicts(resolved)).toEqual([]);
	});

	it('lists conflicts with the pinned pool and kind', () => {
		const resolved = resolveBulkReturnEntries([e1], [moveOf(e1, 1, P1, P2)], [], pins);
		expect(findSnapshotConflicts(resolved)).toEqual([
			{ entry_id: e1._id, pool_id: P1, kind: 'move' }
		]);
	});

	it('leaves a pending (gap) entry out as before', () => {
		expect(resolveBulkReturnEntries([e1], [moveOf(e1, 2, P2, P3)], [], pins)).toEqual([]);
	});
});

describe('P1 -> P2 -> P3 move chain with P2 snapshotted in between', () => {
	const moves = [moveOf(e1, 1, P1, P2), moveOf(e1, 2, P2, P3)];

	it('pins the entry to P2 (its submitted snapshot) and flags the later move', () => {
		const pins = buildSnapshotPins([
			{ _id: P1, status: 'OPEN' },
			{ _id: P2, status: 'SUBMITTED', entry_ids: [e1._id] },
			{ _id: P3, status: 'OPEN' }
		]);
		const resolved = resolveBulkReturnEntries([e1], moves, [], pins);
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toMatchObject({ pool_id: P2, voided: false, snapshot_conflict: 'move' });
		expect(findSnapshotConflicts(resolved)).toEqual([
			{ entry_id: e1._id, pool_id: P2, kind: 'move' }
		]);
		expect(summarizePoolItems([e1], moves, P2, [], pins)).toEqual([
			{ item_id: 'item_master:cot', qty: '5' }
		]);
		expect(summarizePoolItems([e1], moves, P3, [], pins)).toEqual([]);
		expect(summarizePoolItems([e1], moves, P1, [], pins)).toEqual([]);
		expect(isPoolEmpty([e1], moves, P3, [], pins)).toBe(true);
		expect(isPoolEmpty([e1], moves, P2, [], pins)).toBe(false);
	});

	it('resolves to P3 as today when no pool pins the entry', () => {
		const pins = buildSnapshotPins([
			{ _id: P1, status: 'OPEN' },
			{ _id: P2, status: 'OPEN' },
			{ _id: P3, status: 'OPEN' }
		]);
		expect(pins.size).toBe(0);
		const resolved = resolveBulkReturnEntries([e1], moves, [], pins);
		expect(resolved[0].pool_id).toBe(P3);
		expect(resolved[0].snapshot_conflict).toBeUndefined();
		expect(summarizePoolItems([e1], moves, P3, [], pins)).toEqual([
			{ item_id: 'item_master:cot', qty: '5' }
		]);
		expect(summarizePoolItems([e1], moves, P2, [], pins)).toEqual([]);
	});
});
