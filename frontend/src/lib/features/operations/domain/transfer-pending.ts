import type { StockTransfer } from './operations';

/**
 * Transfers that need THIS shelter to act (the buttons `TransferList` offers):
 * outgoing and still `requested` (approve / dispute / cancel), outgoing and
 * `disputed` (resume), or incoming and `shipped` (confirm receipt).
 */
export function isTransferPending(
	transfer: Pick<StockTransfer, 'from_shelter' | 'to_shelter' | 'status'>,
	ownShelter: string
): boolean {
	if (transfer.from_shelter === ownShelter) {
		return transfer.status === 'requested' || transfer.status === 'disputed';
	}
	return transfer.to_shelter === ownShelter && transfer.status === 'shipped';
}

export function countPendingTransfers(
	transfers: readonly Pick<StockTransfer, 'from_shelter' | 'to_shelter' | 'status'>[],
	ownShelter: string
): number {
	return transfers.filter((t) => isTransferPending(t, ownShelter)).length;
}
