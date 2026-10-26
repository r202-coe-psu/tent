import type { BulkReturnEntry } from './bulk-return-entry';
import type { BulkReturnEntryMove } from './bulk-return-entry-move';
import type { BulkReturnEntryVoid } from './bulk-return-entry-void';
import type { ClosedBulkReturnLoanRef } from './bulk-return-loan-drift';
import type { BulkReturnPoolItemSummaryRow, BulkReturnPoolV3 } from './bulk-return-pool-v3';
import {
	findLateEntries,
	findUnresolvedBulkReturnRefs,
	resolveBulkReturnEntries,
	summarizePoolItems,
	type ResolvedBulkReturnEntry,
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
	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids);
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
				items: summarizePoolItems(events.entries, events.moves, pool._id, events.voids),
				entries,
				late_entries: late.filter((r) => r.pool_id === pool._id),
				is_empty: live.length === 0,
				unresolved_refs: unresolved.filter((ref) => ref.pool_ids.includes(pool._id)),
				closed_loan_refs: []
			};
		});
}
