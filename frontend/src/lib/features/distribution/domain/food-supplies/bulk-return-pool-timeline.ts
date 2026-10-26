import type { BulkReturnEntry, BulkReturnEntryReturnerType } from './bulk-return-entry';
import type { BulkReturnEntryMove } from './bulk-return-entry-move';
import type { BulkReturnEntryVoid } from './bulk-return-entry-void';
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
	submitted: 5,
	received: 6,
	cancelled: 7
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
}

export interface PoolTimelineEventSet {
	entries: readonly BulkReturnEntry[];
	moves: readonly BulkReturnEntryMove[];
	voids: readonly BulkReturnEntryVoid[];
}

function compare(a: PoolTimelineEvent, b: PoolTimelineEvent): number {
	if (a.at !== b.at) return a.at < b.at ? -1 : 1;
	if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildPoolTimeline(
	pool: BulkReturnPoolV3,
	events: PoolTimelineEventSet
): PoolTimelineEvent[] {
	const poolId = pool._id;
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
			...(move.notes ? { notes: move.notes } : {})
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
			...(entryVoid.notes ? { notes: entryVoid.notes } : {})
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
