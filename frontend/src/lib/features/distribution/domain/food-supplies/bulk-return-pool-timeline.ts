import type { BulkReturnEntry, BulkReturnEntryReturnerType } from './bulk-return-entry';
import type { BulkReturnEntryMove } from './bulk-return-entry-move';
import type { BulkReturnEntryVoid } from './bulk-return-entry-void';
import type { BulkReturnLoanReopen } from './bulk-return-loan-reopen';
import type { BulkReturnPoolV3 } from './bulk-return-pool-v3';

/**
 * Chronological history of ONE pool: header lifecycle stamps plus the entry / move / void events
 * that touched it. Pure fold; the pool header keeps no edit history, so none is shown.
 */

export type PoolTimelineEventKind =
	| 'opened'
	| 'entry_added'
	| 'moved_in'
	| 'moved_out'
	| 'voided'
	| 'loan_reopened'
	| 'submitted'
	| 'received'
	| 'cancelled';

/** Tie-break order for events with the same timestamp. */
const KIND_ORDER: Record<PoolTimelineEventKind, number> = {
	opened: 0,
	entry_added: 1,
	moved_in: 2,
	moved_out: 3,
	voided: 4,
	loan_reopened: 5,
	submitted: 6,
	received: 7,
	cancelled: 8
};

export interface PoolTimelineEvent {
	/** Source doc id (+ kind for pool stamps); unique within one timeline. */
	id: string;
	kind: PoolTimelineEventKind;
	at: string;
	by: string;
	item_id?: string;
	qty?: string;
	entry_id?: string;
	/** moved_in: the pool it came from; moved_out: the pool it went to. */
	other_pool_id?: string;
	returner_type?: BulkReturnEntryReturnerType;
	returner_id?: string | null;
	notes?: string;
	/**
	 * Only on `voided` / `moved_out` / `moved_in`: the event was written after the entry's snapshot
	 * pool was submitted (CR-193 §33 snapshot pin), so it changed nothing. Shown, not hidden.
	 */
	no_effect?: true;
}

export interface PoolTimelineEventSet {
	entries: readonly BulkReturnEntry[];
	moves: readonly BulkReturnEntryMove[];
	voids: readonly BulkReturnEntryVoid[];
	loanReopens?: readonly BulkReturnLoanReopen[];
}

function compare(a: PoolTimelineEvent, b: PoolTimelineEvent): number {
	if (a.at !== b.at) return a.at < b.at ? -1 : 1;
	if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * `pins` (entry id -> snapshot pool, see `buildSnapshotPins`) marks events with `no_effect`.
 * Rule for an entry pinned to pool P: its void is no-effect; a move of it is no-effect iff its seq
 * is greater than the seq of the move that brought it into P (0 when the entry was created in P),
 * i.e. every move after the entry entered P. The move that brought it into P stays effective.
 * Unpinned entries are unchanged.
 */
export function buildPoolTimeline(
	pool: BulkReturnPoolV3,
	events: PoolTimelineEventSet,
	pins?: ReadonlyMap<string, string>
): PoolTimelineEvent[] {
	const poolId = pool._id;
	const entryPoolById = new Map(events.entries.map((entry) => [entry._id, entry.pool_id]));
	const noEffectMove = (move: BulkReturnEntryMove): boolean => {
		const pinned = pins?.get(move.entry_id);
		if (pinned === undefined) return false;
		let arrival = entryPoolById.get(move.entry_id) === pinned ? 0 : Infinity;
		for (const other of events.moves) {
			if (other.entry_id === move.entry_id && other.to_pool_id === pinned && other.seq < arrival) {
				arrival = other.seq;
			}
		}
		if (arrival === Infinity) arrival = 0;
		return move.seq > arrival;
	};
	const entryById = new Map(events.entries.map((entry) => [entry._id, entry]));
	const returnerOf = (entryId: string) => {
		const entry = entryById.get(entryId);
		return entry ? { returner_type: entry.returner_type, returner_id: entry.returner_id } : {};
	};
	const out: PoolTimelineEvent[] = [
		{ id: `opened:${poolId}`, kind: 'opened', at: pool.created_at, by: pool.created_by }
	];

	for (const entry of events.entries) {
		if (entry.pool_id !== poolId) continue;
		out.push({
			id: entry._id,
			kind: 'entry_added',
			at: entry.created_at,
			by: entry.created_by,
			item_id: entry.item_id,
			qty: entry.qty,
			entry_id: entry._id,
			returner_type: entry.returner_type,
			returner_id: entry.returner_id,
			...(entry.notes ? { notes: entry.notes } : {})
		});
	}

	for (const move of events.moves) {
		const base = {
			at: move.created_at,
			by: move.created_by,
			item_id: move.item_id,
			qty: move.qty,
			entry_id: move.entry_id,
			...returnerOf(move.entry_id),
			...(move.notes ? { notes: move.notes } : {}),
			...(noEffectMove(move) ? { no_effect: true as const } : {})
		};
		if (move.to_pool_id === poolId) {
			out.push({ ...base, id: move._id, kind: 'moved_in', other_pool_id: move.from_pool_id });
		}
		if (move.from_pool_id === poolId) {
			out.push({ ...base, id: move._id, kind: 'moved_out', other_pool_id: move.to_pool_id });
		}
	}

	for (const entryVoid of events.voids) {
		if (entryVoid.pool_id !== poolId) continue;
		out.push({
			id: entryVoid._id,
			kind: 'voided',
			at: entryVoid.created_at,
			by: entryVoid.created_by,
			item_id: entryVoid.item_id,
			qty: entryVoid.qty,
			entry_id: entryVoid.entry_id,
			...returnerOf(entryVoid.entry_id),
			...(entryVoid.notes ? { notes: entryVoid.notes } : {}),
			...(pins?.has(entryVoid.entry_id) ? { no_effect: true as const } : {})
		});
	}

	for (const reopen of events.loanReopens ?? []) {
		if (reopen.pool_id !== poolId) continue;
		const entry = entryById.get(reopen.entry_id);
		out.push({
			id: reopen._id,
			kind: 'loan_reopened',
			at: reopen.created_at,
			by: reopen.created_by,
			...(entry ? { item_id: entry.item_id, qty: entry.qty } : {}),
			entry_id: reopen.entry_id,
			...returnerOf(reopen.entry_id),
			notes: reopen.reason
		});
	}

	const stamps: [PoolTimelineEventKind, string | undefined, string | undefined][] = [
		['submitted', pool.submitted_at, pool.submitted_by],
		['received', pool.received_at, pool.received_by],
		['cancelled', pool.cancelled_at, pool.cancelled_by]
	];
	for (const [kind, at, by] of stamps) {
		if (at) out.push({ id: `${kind}:${poolId}`, kind, at, by: by ?? '' });
	}

	return out.sort(compare);
}
