import type { TicketAmendment } from '../../domain/food-supplies';

export interface TicketAmendmentHistoryRow {
	amendmentId: string;
	itemId: string;
	itemName: string;
	addedQty: string;
	amendedAt: string;
	amendedBy: string;
	reason?: string;
}

/**
 * Builds newest-first display rows for a ticket's amendment audit trail.
 * Amendments are append-only and never persist the pre-amendment allocated_qty, so rows
 * surface only the applied delta ("+N") rather than a reconstructed before/after total —
 * reconstructing history from `allocated_qty` alone would risk showing fabricated numbers
 * for legacy tickets amended before this invariant was enforced.
 */
export function buildAmendmentHistoryRows(
	amendments: readonly TicketAmendment[] | undefined,
	items: readonly { item_id: string; item_name: string }[]
): TicketAmendmentHistoryRow[] {
	if (!amendments || amendments.length === 0) return [];

	const itemNameById = new Map(items.map((item) => [item.item_id, item.item_name]));

	return [...amendments]
		.sort((a, b) => {
			if (a.amended_at !== b.amended_at) return a.amended_at < b.amended_at ? 1 : -1;
			return a.amendment_id < b.amendment_id ? 1 : -1;
		})
		.map((amendment) => ({
			amendmentId: amendment.amendment_id,
			itemId: amendment.item_id,
			itemName: itemNameById.get(amendment.item_id) ?? amendment.item_id,
			addedQty: amendment.added_qty,
			amendedAt: amendment.amended_at,
			amendedBy: amendment.amended_by,
			reason: amendment.reason
		}));
}
