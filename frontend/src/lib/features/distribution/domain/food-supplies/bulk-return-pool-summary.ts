import { addQty, qtyGt, subQty } from '$lib/utils/qty';
import type { BulkReturnEntry } from './bulk-return-entry';
import { foldEntryMoves, type BulkReturnEntryMove } from './bulk-return-entry-move';
import type { BulkReturnEntryVoid } from './bulk-return-entry-void';
import type { BulkReturnPoolItemSummaryRow, BulkReturnPoolV3 } from './bulk-return-pool-v3';

type EntryLike = Pick<BulkReturnEntry, '_id' | 'pool_id' | 'item_id' | 'qty'>;
type MoveLike = Pick<
	BulkReturnEntryMove,
	'entry_id' | 'seq' | 'from_pool_id' | 'to_pool_id' | 'item_id' | 'qty'
>;
type VoidLike = Pick<BulkReturnEntryVoid, 'entry_id' | 'pool_id' | 'item_id' | 'qty'>;
type PoolLike = Pick<BulkReturnPoolV3, '_id' | 'status' | 'entry_ids'>;

export interface ResolvedBulkReturnEntry<E extends EntryLike = EntryLike> {
	entry: E;
	pool_id: string;
	voided: boolean;
	/**
	 * Set only for an entry pinned to a closed pool's snapshot (see `buildSnapshotPins`) that has a
	 * post-snapshot move out (`move`) or void (`void`; wins when both). The event has no effect: the
	 * entry stays counted in its snapshot pool, not voided. Staff must reconcile it.
	 */
	snapshot_conflict?: 'void' | 'move';
}

export type SnapshotConflictKind = 'void' | 'move';

/** Entry id -> id of the closed pool whose `entry_ids` snapshot counted it. */
export type SnapshotPins = ReadonlyMap<string, string>;

/**
 * Snapshot pin rule: an entry id listed in a non-OPEN pool's `entry_ids` belongs to that pool
 * permanently. Voids are only allowed on OPEN unlocked pools and a legitimate move out of a closed
 * pool only happens for LATE entries (not in `entry_ids`), so any void/move of a pinned entry was
 * written after the snapshot. When an id is in two pools, the earliest `submitted_at` wins.
 */
export function buildSnapshotPins(
	pools: readonly (Pick<PoolLike, '_id' | 'status' | 'entry_ids'> & { submitted_at?: string })[]
): Map<string, string> {
	const pins = new Map<string, string>();
	const at = new Map<string, string>();
	for (const pool of pools) {
		if (pool.status === 'OPEN' || !pool.entry_ids) continue;
		const submittedAt = pool.submitted_at ?? '';
		for (const id of pool.entry_ids) {
			const prev = at.get(id);
			if (prev === undefined || submittedAt < prev) {
				pins.set(id, pool._id);
				at.set(id, submittedAt);
			}
		}
	}
	return pins;
}

/** items_summary minus the qty of entries in pool.entry_ids that are pinned to ANOTHER pool. Rows are kept (qty floored at '0'), same order. An entry id whose doc is not in `entries` is kept as counted here. */
export function pinnedItemsSummary(
	pool: Pick<BulkReturnPoolV3, '_id' | 'items_summary' | 'entry_ids'>,
	entries: readonly Pick<BulkReturnEntry, '_id' | 'item_id' | 'qty'>[],
	pins: SnapshotPins
): BulkReturnPoolItemSummaryRow[] {
	const rows = pool.items_summary ?? [];
	const entryById = new Map(entries.map((e) => [e._id, e]));
	const excluded = new Map<string, string>();
	for (const id of pool.entry_ids ?? []) {
		const owner = pins.get(id);
		const entry = entryById.get(id);
		if (owner === undefined || owner === pool._id || !entry) continue;
		excluded.set(entry.item_id, addQty(excluded.get(entry.item_id) ?? '0', entry.qty));
	}
	return rows.map((row) => {
		const sub = excluded.get(row.item_id);
		if (sub === undefined) return row;
		const left = subQty(row.qty, sub);
		return { ...row, qty: qtyGt(left, 0) ? left : '0' };
	});
}

/** Entries whose move/void was written after their snapshot pool closed (no effect applied). */
export function findSnapshotConflicts(
	resolved: readonly ResolvedBulkReturnEntry[]
): { entry_id: string; pool_id: string; kind: SnapshotConflictKind }[] {
	return resolved.flatMap((r) =>
		r.snapshot_conflict
			? [{ entry_id: r.entry._id, pool_id: r.pool_id, kind: r.snapshot_conflict }]
			: []
	);
}

/**
 * Folds the append-only event log: resolves every entry to its current pool and voided flag.
 * A move/void whose entry doc is not present (out-of-order replication) is skipped: it cannot
 * change any known entry, and the fold self-heals once the entry arrives (see
 * `findUnresolvedBulkReturnRefs` to surface them).
 * An entry whose move chain has a gap (an earlier seq not replicated yet) is "pending sync": it
 * is OMITTED from the result (it counts in no pool) and self-heals once the missing move arrives.
 * Throws on: a duplicate entry, an invalid move chain (see `foldEntryMoves`), more than one void
 * per entry, a void whose item_id/qty differ from the entry, or (for a non-pending entry) a void
 * whose pool_id differs from the entry's resolved pool (which also catches a move written after
 * the void). A pending entry's void pool_id is not checkable and is skipped.
 * `pins` (see `buildSnapshotPins`): a pinned entry resolves to its snapshot pool, never voided; a
 * differing fold pool or a void is flagged via `snapshot_conflict` (the void is still validated
 * against the fold pool, so it never throws for a doc that was valid when written).
 */
export function resolveBulkReturnEntries<E extends EntryLike>(
	entries: readonly E[],
	moves: readonly MoveLike[],
	voids: readonly VoidLike[] = [],
	pins?: SnapshotPins
): ResolvedBulkReturnEntry<E>[] {
	const movesByEntry = new Map<string, MoveLike[]>();
	for (const move of moves) {
		const list = movesByEntry.get(move.entry_id) ?? [];
		list.push(move);
		movesByEntry.set(move.entry_id, list);
	}
	const voidsByEntry = new Map<string, VoidLike>();
	for (const v of voids) {
		if (voidsByEntry.has(v.entry_id)) {
			throw new Error(`Multiple voids for bulk_return_entry ${v.entry_id}`);
		}
		voidsByEntry.set(v.entry_id, v);
	}
	const seen = new Set<string>();
	for (const entry of entries) {
		if (seen.has(entry._id)) throw new Error(`Duplicate bulk_return_entry ${entry._id}`);
		seen.add(entry._id);
	}
	const out: ResolvedBulkReturnEntry<E>[] = [];
	for (const entry of entries) {
		const fold = foldEntryMoves(entry, movesByEntry.get(entry._id) ?? []);
		const v = voidsByEntry.get(entry._id);
		if (v && (v.item_id !== entry.item_id || v.qty !== entry.qty)) {
			throw new Error(`Void of ${entry._id} does not match entry item_id/qty`);
		}
		if (fold.status === 'pending') continue;
		const pool_id = fold.pool_id;
		if (v && v.pool_id !== pool_id) {
			throw new Error(
				`Void of ${entry._id} is for ${v.pool_id} but the entry resolves to ${pool_id}`
			);
		}
		const pinned = pins?.get(entry._id);
		if (pinned !== undefined) {
			const snapshot_conflict = v ? 'void' : pool_id !== pinned ? 'move' : undefined;
			out.push({
				entry,
				pool_id: pinned,
				voided: false,
				...(snapshot_conflict ? { snapshot_conflict } : {})
			});
			continue;
		}
		out.push({ entry, pool_id, voided: v !== undefined });
	}
	return out;
}

export interface UnresolvedBulkReturnRef {
	kind: 'move' | 'void' | 'move_gap';
	entry_id: string;
	/**
	 * Pools the event names: move from/to, or the void's pool_id. For `move_gap`: the entry's
	 * original pool, every known move's from/to, and the void's pool_id if any.
	 */
	pool_ids: string[];
	/** `move_gap` only: the move seqs not replicated yet, ascending. */
	missing_seqs?: number[];
}

/**
 * Move/void docs whose entry doc is not among `entries` (pending replication or a stray write),
 * plus one `move_gap` item per known entry whose move chain has a gap (pending sync).
 * Ordered by entry_id, then kind, then seq (a `move_gap` uses its first missing seq).
 */
export function findUnresolvedBulkReturnRefs(
	entries: readonly EntryLike[],
	moves: readonly MoveLike[],
	voids: readonly VoidLike[] = []
): UnresolvedBulkReturnRef[] {
	const known = new Set(entries.map((e) => e._id));
	const out: { ref: UnresolvedBulkReturnRef; seq: number }[] = [];
	const movesByEntry = new Map<string, MoveLike[]>();
	for (const m of moves) {
		if (!known.has(m.entry_id)) continue;
		const list = movesByEntry.get(m.entry_id) ?? [];
		list.push(m);
		movesByEntry.set(m.entry_id, list);
	}
	const voidByEntry = new Map(voids.map((v) => [v.entry_id, v]));
	for (const entry of entries) {
		const fold = foldEntryMoves(entry, movesByEntry.get(entry._id) ?? []);
		if (fold.status !== 'pending') continue;
		const voidPool = voidByEntry.get(entry._id)?.pool_id;
		out.push({
			ref: {
				kind: 'move_gap',
				entry_id: entry._id,
				pool_ids: [...new Set([...fold.pool_ids, ...(voidPool ? [voidPool] : [])])],
				missing_seqs: fold.missing_seqs
			},
			seq: fold.missing_seqs[0]
		});
	}
	for (const m of moves) {
		if (known.has(m.entry_id)) continue;
		out.push({
			ref: {
				kind: 'move',
				entry_id: m.entry_id,
				pool_ids: [...new Set([m.from_pool_id, m.to_pool_id])]
			},
			seq: m.seq
		});
	}
	for (const v of voids) {
		if (known.has(v.entry_id)) continue;
		out.push({ ref: { kind: 'void', entry_id: v.entry_id, pool_ids: [v.pool_id] }, seq: 0 });
	}
	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	return out
		.sort(
			(a, b) => cmp(a.ref.entry_id, b.ref.entry_id) || cmp(a.ref.kind, b.ref.kind) || a.seq - b.seq
		)
		.map(({ ref }) => ref);
}

/**
 * Per-item totals of the non-voided entries currently in `poolId`, sorted by item_id. This is the
 * value written to the pool's `items_summary` at submit.
 */
export function summarizePoolItems(
	entries: readonly EntryLike[],
	moves: readonly MoveLike[],
	poolId: string,
	voids: readonly VoidLike[] = [],
	pins?: SnapshotPins
): BulkReturnPoolItemSummaryRow[] {
	const totals = new Map<string, string>();
	for (const { entry, pool_id, voided } of resolveBulkReturnEntries(entries, moves, voids, pins)) {
		if (voided || pool_id !== poolId) continue;
		totals.set(entry.item_id, addQty(totals.get(entry.item_id) ?? '0', entry.qty));
	}
	return [...totals.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([item_id, qty]) => ({ item_id, qty }));
}

/**
 * True when no non-voided entry currently resolves to `poolId`. Advisory input for cancelling a
 * pool: validate_doc_update cannot count entry docs, so "cancel only when empty" is enforced by
 * this fold plus the CANCEL lock in the cancel workflow, not by the database.
 */
export function isPoolEmpty(
	entries: readonly EntryLike[],
	moves: readonly MoveLike[],
	poolId: string,
	voids: readonly VoidLike[] = [],
	pins?: SnapshotPins
): boolean {
	return resolveBulkReturnEntries(entries, moves, voids, pins).every(
		({ pool_id, voided }) => voided || pool_id !== poolId
	);
}

/** Sorted ids of the non-voided entries in `poolId`: the `entry_ids` fence written at submit. */
export function poolSnapshotEntryIds(
	resolved: readonly ResolvedBulkReturnEntry[],
	poolId: string
): string[] {
	return resolved
		.filter(({ pool_id, voided }) => !voided && pool_id === poolId)
		.map(({ entry }) => entry._id)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A late entry is one that resolves into a pool that is no longer OPEN yet is not in that pool's
 * submitted `entry_ids` fence (an absent `entry_ids`, e.g. CANCELLED, counts as empty).
 */
export function isLateEntry(
	entryId: string,
	pool: Pick<PoolLike, 'status' | 'entry_ids'>
): boolean {
	return pool.status !== 'OPEN' && !(pool.entry_ids ?? []).includes(entryId);
}

/** Non-voided resolved entries that landed in a known, non-OPEN pool after its fence. */
export function findLateEntries<E extends EntryLike>(
	resolved: readonly ResolvedBulkReturnEntry<E>[],
	pools: readonly PoolLike[]
): ResolvedBulkReturnEntry<E>[] {
	const poolById = new Map(pools.map((pool) => [pool._id, pool]));
	return resolved.filter(({ entry, pool_id, voided }) => {
		if (voided) return false;
		const pool = poolById.get(pool_id);
		return pool !== undefined && isLateEntry(entry._id, pool);
	});
}
