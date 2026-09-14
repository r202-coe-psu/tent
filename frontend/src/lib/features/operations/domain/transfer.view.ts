/**
 * T-13 — Read-only view helpers for a `stock_transfer` (CR-091 detail page + transfer list).
 *
 * Pure TypeScript — no I/O, no Svelte. Both the list and the detail page call these so the
 * side / reason / timeline rules live in exactly one place (CR-091 FR-02, FR-07).
 */

import type { StockTransfer, TransferTimelineEvent } from './operations';

/** Which end of a transfer the viewing shelter is. */
export type TransferSide = 'source' | 'destination' | 'none';

/**
 * CR-091 FR-02 — the viewing shelter's role in this transfer.
 *
 * `'none'` only happens for a `system_admin` who opens a transfer between two other shelters by
 * URL; the list filters by shelter, so its rows are always `'source'` or `'destination'`.
 */
export function transferSide(t: StockTransfer, shelterCode: string): TransferSide {
	if (t.from_shelter === shelterCode) return 'source';
	if (t.to_shelter === shelterCode) return 'destination';
	return 'none';
}

/**
 * CR-090 FR-10 / CR-091 FR-07 — the reason a transfer stopped, shown next to the status that
 * demands it.
 *
 * Reading it off the status rather than off the field is what keeps the view honest: a
 * `*_reason` only ever belongs to one status (CR-090 FR-04), so a stale value left on a document
 * by an older build can never surface under the wrong label.
 */
export function transferStatusReason(t: StockTransfer): string | undefined {
	if (t.status === 'disputed') return t.dispute_reason;
	if (t.status === 'cancelled') return t.cancel_reason;
	return undefined;
}

export type TransferStepKey = 'requested' | 'disputed' | 'shipped' | 'received';

export interface TransferStep extends TransferTimelineEvent {
	key: TransferStepKey;
}

const STEP_ORDER: readonly TransferStepKey[] = ['requested', 'disputed', 'shipped', 'received'];

/**
 * CR-091 FR-04 + CR-089 FR-11 — the timeline entries present on the document, in the fixed order
 * requested → disputed → shipped → received.
 *
 * The order is fixed rather than sorted by `at`: `disputed` can only follow `requested`
 * (CR-089 FR-07), so it always precedes `shipped`. `disputed` stays after a resume — the timeline
 * is history. `cancelled` has no timeline slot, so it is never a step and no time is inferred
 * for it.
 */
export function transferTimelineSteps(t: StockTransfer): TransferStep[] {
	const steps: TransferStep[] = [];
	for (const key of STEP_ORDER) {
		const event = t.timeline[key];
		if (event) steps.push({ key, at: event.at, by: event.by });
	}
	return steps;
}

/**
 * CR-091 FR-03 — a stable `{#each}` key per item line, index-aligned with `t.items`.
 *
 * CR-118 FR-02 allows the same `item_id` on more than one line, so `item_id` alone is not unique.
 * Until CR-118 lands `line_id`, the key is `${item_id}#${n}` where `n` counts earlier lines with
 * the same `item_id` — deterministic for a given document, and never collides because the suffix
 * after the last `#` is always a plain occurrence number.
 */
export function transferLineKeys(t: StockTransfer): string[] {
	const seen = new Map<string, number>();
	return t.items.map((item) => {
		const n = seen.get(item.item_id) ?? 0;
		seen.set(item.item_id, n + 1);
		return `${item.item_id}#${n}`;
	});
}
