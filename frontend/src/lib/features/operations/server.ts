/**
 * Server-safe entry point for the operations feature.
 *
 * The feature barrel (`$lib/features/operations`) re-exports the application,
 * data, and UI layers — Svelte components, TanStack Query, and the remote CouchDB
 * client — none of which can be evaluated in a server/test context (importing it
 * from a `+server.ts` pulls Superforms and Svelte in and crashes at module load).
 *
 * This file re-exports only the pure domain layer (no I/O, no Svelte), so server
 * code can mint documents from the same factories the client uses. The path
 * `$lib/features/operations/server` intentionally does not match the
 * no-restricted-imports patterns (which only cover domain, data, application, ui),
 * mirroring `$lib/features/shelters/server`.
 */

export {
	createStockLedger,
	createWalkInDonation,
	keyDonationReceipt,
	receiveDonation,
	expireDonation,
	canTransitionDonation,
	stockBalance,
	isStockLedger,
	isDonation,
	stockLedgerInputSchema,
	stockLedgerDocSchema,
	parseStockLedger,
	donationStatusSchema,
	ledgerReasonSchema,
	createTransfer,
	dispatchTransfer,
	receiveTransfer,
	cancelTransfer,
	isStockTransfer,
	parseStockTransfer,
	stockTransferDocSchema,
	transferInputSchema,
	transferStatusSchema,
	transferFilterSchema,
	receivedItemSchema,
	nextLotNos,
	lotDateStamp,
	stockLotSchema,
	LOT_NO_PATTERN
} from './domain/operations';

export type {
	CountedItem,
	Donation,
	DonationItem,
	DonationStatus,
	LedgerReason,
	StockLedger,
	StockLot,
	StockTransfer,
	StockTransferItem,
	TransferInput,
	TransferStatus,
	TransferFilter,
	ReceivedItemInput
} from './domain/operations';

export {
	assertActorMayTransition as assertActorMayTransitionTransfer,
	assertActorMayDelete as assertActorMayDeleteTransfer,
	assertActorMayRestore as assertActorMayRestoreTransfer,
	TransferAuthorizationError
} from './domain/transfer.authorization';
