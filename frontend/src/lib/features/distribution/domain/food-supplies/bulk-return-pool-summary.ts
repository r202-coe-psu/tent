import { addQty } from '$lib/utils/qty';
import type { BulkReturnEntry } from './bulk-return-entry';
import { resolveEntryPool, type BulkReturnEntryMove } from './bulk-return-entry-move';
import type { BulkReturnPoolItemSummaryRow } from './bulk-return-pool-v3';

type EntryLike = Pick<BulkReturnEntry, '_id' | 'pool_id' | 'item_id' | 'qty'>;
type MoveLike = Pick<
	BulkReturnEntryMove,
	'entry_id' | 'seq' | 'from_pool_id' | 'to_pool_id' | 'item_id' | 'qty'
>;

export interface ResolvedBulkReturnEntry<E extends EntryLike = EntryLike> {
	entry: E;
	pool_id: string;
}

/**
 * Folds the append-only event log: resolves every entry to its current pool.
 * Throws on a duplicate entry, a move for an unknown entry, or a broken move chain.
 */
export function resolveBulkReturnEntries<E extends EntryLike>(
	entries: readonly E[],
	moves: readonly MoveLike[]
): ResolvedBulkReturnEntry<E>[] {
	const movesByEntry = new Map<string, MoveLike[]>();
	for (const move of moves) {
		const list = movesByEntry.get(move.entry_id) ?? [];
		list.push(move);
		movesByEntry.set(move.entry_id, list);
	}
	const seen = new Set<string>();
	for (const entry of entries) {
		if (seen.has(entry._id)) throw new Error(`Duplicate bulk_return_entry ${entry._id}`);
		seen.add(entry._id);
	}
	for (const entryId of movesByEntry.keys()) {
		if (!seen.has(entryId)) throw new Error(`Move references unknown entry ${entryId}`);
	}
	return entries.map((entry) => ({
		entry,
		pool_id: resolveEntryPool(entry, movesByEntry.get(entry._id) ?? [])
	}));
}

/**
 * Per-item totals of the entries currently in `poolId`, sorted by item_id. This is the value
 * written to the pool's `items_summary` at submit.
 */
export function summarizePoolItems(
	entries: readonly EntryLike[],
	moves: readonly MoveLike[],
	poolId: string
): BulkReturnPoolItemSummaryRow[] {
	const totals = new Map<string, string>();
	for (const { entry, pool_id } of resolveBulkReturnEntries(entries, moves)) {
		if (pool_id !== poolId) continue;
		totals.set(entry.item_id, addQty(totals.get(entry.item_id) ?? '0', entry.qty));
	}
	return [...totals.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([item_id, qty]) => ({ item_id, qty }));
}

/** True when no entry currently resolves to `poolId` (the "delete only when empty" check). */
export function isPoolEmpty(
	entries: readonly EntryLike[],
	moves: readonly MoveLike[],
	poolId: string
): boolean {
	return resolveBulkReturnEntries(entries, moves).every(({ pool_id }) => pool_id !== poolId);
}
