import { addQty } from '$lib/utils/qty';
import type { BulkReturnEntry } from './bulk-return-entry';
import { resolveEntryPool, type BulkReturnEntryMove } from './bulk-return-entry-move';
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
}

/**
 * Folds the append-only event log: resolves every entry to its current pool and voided flag.
 * A move/void whose entry doc is not present (out-of-order replication) is skipped: it cannot
 * change any known entry, and the fold self-heals once the entry arrives (see
 * `findUnresolvedBulkReturnRefs` to surface them).
 * Throws on: a duplicate entry, a broken move chain, more than one void per entry, a void whose
 * item_id/qty differ from the entry, or a void whose pool_id differs from the entry's resolved
 * pool (which also catches a move written after the void).
 */
export function resolveBulkReturnEntries<E extends EntryLike>(
	entries: readonly E[],
	moves: readonly MoveLike[],
	voids: readonly VoidLike[] = []
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
	return entries.map((entry) => {
		const pool_id = resolveEntryPool(entry, movesByEntry.get(entry._id) ?? []);
		const v = voidsByEntry.get(entry._id);
		if (v) {
			if (v.item_id !== entry.item_id || v.qty !== entry.qty) {
				throw new Error(`Void of ${entry._id} does not match entry item_id/qty`);
			}
			if (v.pool_id !== pool_id) {
				throw new Error(
					`Void of ${entry._id} is for ${v.pool_id} but the entry resolves to ${pool_id}`
				);
			}
		}
		return { entry, pool_id, voided: v !== undefined };
	});
}

export interface UnresolvedBulkReturnRef {
	kind: 'move' | 'void';
	entry_id: string;
	/** Pools the event names: move from/to, or the void's pool_id. */
	pool_ids: string[];
}

/**
 * Move/void docs whose entry doc is not among `entries` (pending replication or a stray write).
 * One item per orphan doc, ordered by entry_id, then kind, then seq.
 */
export function findUnresolvedBulkReturnRefs(
	entries: readonly EntryLike[],
	moves: readonly MoveLike[],
	voids: readonly VoidLike[] = []
): UnresolvedBulkReturnRef[] {
	const known = new Set(entries.map((e) => e._id));
	const out: { ref: UnresolvedBulkReturnRef; seq: number }[] = [];
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
	voids: readonly VoidLike[] = []
): BulkReturnPoolItemSummaryRow[] {
	const totals = new Map<string, string>();
	for (const { entry, pool_id, voided } of resolveBulkReturnEntries(entries, moves, voids)) {
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
	voids: readonly VoidLike[] = []
): boolean {
	return resolveBulkReturnEntries(entries, moves, voids).every(
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
