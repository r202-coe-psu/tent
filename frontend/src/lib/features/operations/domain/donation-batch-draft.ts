import { qtyGt } from '$lib/utils/qty';
import { initialExpiryState, type ExpiryState } from './lot-expiry';
import type { Donation } from './operations';

/**
 * One editable line of the batch receive form (CR-143 FR-B1–B3). UI state only:
 * `toBatchLines` in the form turns it into a `DonationBatchLine` for the repository.
 */
export interface BatchLineDraft {
	/** Stable identity of the line — part of its ledger `_id`, never reused or renumbered. */
	line_no: number;
	/** '' = not matched to the catalog yet (a `free_text` line, or a new line off the ticket). */
	item_id: string;
	/** The donor's wording, for a `free_text` line (FR-B2). */
	free_text?: string;
	/** What the ticket declared; absent for a line added off the ticket. */
	declared_qty?: string;
	/** Unit of `qty` — the ticket's unit, converted to the item's base unit when saved. */
	unit: string;
	/** What was physically counted; '' until typed, '0' = not received. */
	qty: string;
	expiry: ExpiryState;
	/** Already in the ledger: shown read-only and never re-sent as a change. */
	locked: boolean;
	/** Last write outcome of this line, shown beside it. */
	error?: string;
}

/**
 * Lines for a freshly selected ticket: one per `donation.items[]` entry, in order,
 * with "received" defaulting to the declared quantity (FR-B1). `line_no` is the
 * entry's index, so it is stable for as long as the donation's items are.
 */
export function initialBatchDrafts(donation: Donation): BatchLineDraft[] {
	return (donation.items ?? []).map((item, index) => ({
		line_no: index,
		item_id: item.item_id ?? '',
		...(item.free_text && !item.item_id ? { free_text: item.free_text } : {}),
		declared_qty: item.qty,
		unit: item.unit,
		qty: item.qty,
		expiry: initialExpiryState(),
		locked: false
	}));
}

/** A line that will become a ledger row. */
export function isReceivedDraft(draft: Pick<BatchLineDraft, 'qty'>): boolean {
	const qty = draft.qty.trim();
	return qty !== '' && Number.isFinite(Number(qty)) && qtyGt(qty, 0);
}

/**
 * What stops this draft from being saved, or null. `requiresExpiry` is the
 * catalog's FR-D1 answer for the matched item (FR-D2: no blank `lot.expiry`).
 */
export function draftProblem(
	draft: BatchLineDraft,
	requiresExpiry: boolean
): 'qty' | 'item' | 'expiry' | null {
	const qty = draft.qty.trim();
	if (qty === '' || !Number.isFinite(Number(qty)) || Number(qty) < 0) return 'qty';
	if (!isReceivedDraft(draft)) return null;
	if (!draft.item_id) return 'item';
	if (!draft.locked && requiresExpiry && !draft.expiry.value.trim()) return 'expiry';
	return null;
}
