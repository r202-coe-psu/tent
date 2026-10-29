import type { BulkReturnEntry } from './bulk-return-entry';
import type { BulkReturnEntryMove } from './bulk-return-entry-move';
import type { BulkReturnEntryVoid } from './bulk-return-entry-void';
import type { ClosedBulkReturnLoanRef } from './bulk-return-loan-drift';
import type { BulkReturnPoolItemSummaryRow, BulkReturnPoolV3 } from './bulk-return-pool-v3';
import {
	buildSnapshotPins,
	findLateEntries,
	findSnapshotConflicts,
	findUnresolvedBulkReturnRefs,
	pinnedItemsSummary,
	resolveBulkReturnEntries,
	summarizePoolItems,
	type ResolvedBulkReturnEntry,
	type SnapshotConflictKind,
	type UnresolvedBulkReturnRef
} from './bulk-return-pool-summary';

/**
 * #659 — read model for the pool list / detail. Pure fold over the pools and the append-only
 * entry / move / void events (the events are the source of truth for what is in a pool).
 */

export interface BulkReturnEventSet {
	entries: BulkReturnEntry[];
	moves: BulkReturnEntryMove[];
	voids: BulkReturnEntryVoid[];
	/** Docs the read left out because they failed validation (typed structurally: domain cannot import data). */
	skipped: { _id: string; type: string; reason: string }[];
}

export interface BulkReturnPoolOverviewRow {
	pool: BulkReturnPoolV3;
	/** Non-voided entries currently in the pool. */
	entry_count: number;
	/** Per-item totals of the non-voided entries currently in the pool, sorted by item_id. */
	items: BulkReturnPoolItemSummaryRow[];
	/** Every entry currently resolving into the pool (voided ones flagged), oldest first. */
	entries: ResolvedBulkReturnEntry<BulkReturnEntry>[];
	/** Non-voided entries stuck in this (non-OPEN) pool after its fence: move them out. */
	late_entries: ResolvedBulkReturnEntry<BulkReturnEntry>[];
	/**
	 * Entries of this closed pool whose void/move was written after its snapshot: the event has no
	 * effect (the entry stays counted here), staff must reconcile it.
	 */
	snapshot_conflicts: { entry_id: string; kind: SnapshotConflictKind }[];
	/** True when no non-voided entry is in the pool (a pool may only be cancelled when empty). */
	is_empty: boolean;
	/**
	 * Move/void events naming this pool whose entry doc is not here yet, or entries whose move
	 * chain has a gap (pending replication); such entries count in no pool until they resolve.
	 */
	unresolved_refs: UnresolvedBulkReturnRef[];
	/**
	 * Loan refs of the live entries that were not applied and cannot be applied now (loan closed /
	 * short / missing). The pure builder leaves this empty: it needs the current loans, so the
	 * overview read enriches it (one batched loan read).
	 */
	closed_loan_refs: ClosedBulkReturnLoanRef[];
	/**
	 * True when the overview's batched loan read failed and this non-cancelled row has live entries
	 * with loan refs (`liveLoanRefCount > 0`), so `closed_loan_refs` is unknown (left empty) rather
	 * than verified clean. The pure builder always sets `false`.
	 */
	loan_refs_unavailable: boolean;
	/**
	 * What the warehouse can receive from this pool: its submitted `items_summary` minus the qty of
	 * entries that are in its `entry_ids` but pinned to ANOTHER pool (an entry double-counted by a
	 * later pool is received by the earlier one only). `[]` for OPEN and CANCELLED pools: they have
	 * no submitted snapshot to receive from.
	 */
	receivable_items_summary: BulkReturnPoolItemSummaryRow[];
}

/**
 * Non-voided entries of a non-cancelled pool row; `[]` for a CANCELLED pool. The single source of
 * the "live entries of a non-cancelled pool" rule (loan read, degrade flag and work queue count).
 */
export function liveEntriesOf(
	row: Pick<BulkReturnPoolOverviewRow, 'pool' | 'entries'>
): BulkReturnEntry[] {
	if (row.pool.status === 'CANCELLED') return [];
	return row.entries.filter((r) => !r.voided).map((r) => r.entry);
}

/**
 * Loan refs of the live entries (`liveEntriesOf`) of a pool row; 0 for a CANCELLED pool. Single
 * source for "does this row have live loan refs" (loan read degrade flag and work queue count).
 */
export function liveLoanRefCount(row: Pick<BulkReturnPoolOverviewRow, 'pool' | 'entries'>): number {
	return liveEntriesOf(row).reduce((sum, entry) => sum + entry.loan_refs.length, 0);
}

export interface BulkReturnPoolOverviewOptions {
	/** CANCELLED pools are hidden unless requested. */
	includeCancelled?: boolean;
}

function newestFirst(a: BulkReturnPoolV3, b: BulkReturnPoolV3): number {
	return a._id < b._id ? 1 : a._id > b._id ? -1 : 0;
}

/**
 * One row per pool (newest first; CANCELLED excluded unless `includeCancelled`). Throws when the
 * event log is inconsistent (see `resolveBulkReturnEntries`). Move/void events whose entry doc is
 * missing, and entries whose move chain has a gap, do not throw; they are listed per pool in
 * `unresolved_refs` (a gappy entry is omitted from every row's entries/items/counts).
 */
export function buildBulkReturnPoolOverview(
	pools: readonly BulkReturnPoolV3[],
	events: BulkReturnEventSet,
	options: BulkReturnPoolOverviewOptions = {}
): BulkReturnPoolOverviewRow[] {
	const pins = buildSnapshotPins(pools);
	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids, pins);
	const late = findLateEntries(resolved, pools);
	const unresolved = findUnresolvedBulkReturnRefs(events.entries, events.moves, events.voids);
	return [...pools]
		.filter((pool) => options.includeCancelled || pool.status !== 'CANCELLED')
		.sort(newestFirst)
		.map((pool) => {
			const entries = resolved
				.filter((r) => r.pool_id === pool._id)
				.sort((a, b) => (a.entry._id < b.entry._id ? -1 : a.entry._id > b.entry._id ? 1 : 0));
			const live = entries.filter((r) => !r.voided);
			return {
				pool,
				entry_count: live.length,
				items: summarizePoolItems(events.entries, events.moves, pool._id, events.voids, pins),
				entries,
				snapshot_conflicts: findSnapshotConflicts(entries).map(({ entry_id, kind }) => ({
					entry_id,
					kind
				})),
				late_entries: late.filter((r) => r.pool_id === pool._id),
				is_empty: live.length === 0,
				unresolved_refs: unresolved.filter((ref) => ref.pool_ids.includes(pool._id)),
				closed_loan_refs: [],
				loan_refs_unavailable: false,
				receivable_items_summary:
					pool.status === 'SUBMITTED' || pool.status === 'RECEIVED'
						? pinnedItemsSummary(pool, events.entries, pins)
						: []
			};
		});
}
