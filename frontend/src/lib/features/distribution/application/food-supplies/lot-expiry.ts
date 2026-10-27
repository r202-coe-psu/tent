import { deriveDeterministicLedgerId, type OperationsRepository } from '$lib/features/operations';

/** The one repository call the lookup needs. */
export type LedgerEntryReader = Pick<OperationsRepository, 'getLedgerEntry'>;

/**
 * `lot.expiry` of the stock lot dispatched for a ticket item (FR-MQW-06 B).
 *
 * Two point reads, no ledger scan: the dispatch `distribute` row has a deterministic id
 * (`dispatchTicket`), and its `lot_ref` names the lot row that carries the expiry. When an item
 * is split across lots (#655) that id belongs to the row of the earliest-expiry lot. Legacy
 * dispatches that picked no lot point `lot_ref` at themselves, so their own `lot` is used.
 * Returns `undefined` when the ticket was never dispatched or the lot has no expiry.
 */
export async function resolveDispatchedLotExpiry(
	ticketId: string,
	itemId: string,
	repo: LedgerEntryReader
): Promise<string | undefined> {
	const dispatchId = await deriveDeterministicLedgerId('dispatch', ticketId, itemId);
	const dispatch = await repo.getLedgerEntry(dispatchId);
	if (!dispatch) return undefined;
	if (!dispatch.lot_ref || dispatch.lot_ref === dispatch._id) return dispatch.lot?.expiry;
	const lot = await repo.getLedgerEntry(dispatch.lot_ref);
	return lot?.lot?.expiry;
}
