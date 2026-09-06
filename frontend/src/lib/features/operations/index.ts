/**
 * Public API of the `operations` feature (stock, donations, campaigns — R2–R3).
 * Cross-feature and route code imports ONLY from here.
 */

// Domain — documents
export type {
	StockLedger,
	StockLot,
	Donation,
	Donor,
	DonationItem,
	DonationCampaign,
	CampaignNeed,
	CountedItem,
	Purchase,
	PurchaseItem,
	OperationsDoc,
	LedgerReason,
	DonationStatus,
	TransferStatus,
	DonationChannel,
	DonationSlot,
	NeedAvailability,
	StockTransfer,
	StockTransferItem,
	TransferInput,
	TransferFilter
} from './domain/operations';

// Domain — schemas + factories + transitions + read models + guards
export {
	ledgerReasonSchema,
	donationStatusSchema,
	DONATION_OUTSTANDING_STATUSES,
	isDonationOutstanding,
	transferStatusSchema,
	donationChannelSchema,
	stockLedgerInputSchema,
	stockLedgerDocSchema,
	parseStockLedger,
	receiveInputSchema,
	walkInDonationInputSchema,
	campaignInputSchema,
	createStockLedger,
	createWalkInDonation,
	createCampaign,
	createPurchase,
	keyDonationReceipt,
	keyPurchaseReceipt,
	purchaseReceiptStatus,
	canEditPurchase,
	purchaseInputSchema,
	purchaseReceiptInputSchema,
	isPurchase,
	type PurchaseInput,
	type PurchaseReceiptInput,
	type PurchaseReceiptStatus,
	receiveDonation,
	expireDonation,
	canTransitionDonation,
	stockBalance,
	openNeeds,
	calculateReserved,
	keyedDonationIds,
	keyableDonations,
	isNeedCutOff,
	forceCutOffNeed,
	reopenNeed,
	editNeed,
	buildCampaignNotes,
	parseCampaignNotes,
	type CampaignNotesParts,
	deriveNeedAvailability,
	isStockLedger,
	isDonation,
	isDonationCampaign,
	isDonationSlot,
	mapNeedItemHeuristic,
	publicItemAggregate,
	type StockLedgerInput,
	type ReceiveInput,
	type WalkInDonationInput,
	type CampaignInput,
	receiveSourceSchema,
	createReceiveEntry,
	distributeInputSchema,
	createDistributeEntry,
	type DistributeInput,
	adjustInputSchema,
	createAdjustEntry,
	type AdjustInput,
	createTransfer,
	dispatchTransfer,
	receiveTransfer,
	cancelTransfer,
	isStockTransfer,
	transferInputSchema,
	transferFilterSchema,
	receivedItemSchema,
	type ReceivedItemInput
} from './domain/operations';

// Data — repository contract + remote CouchDB binding
export type { OperationsRepository } from './data/operations.repository';
export { operationsRepository, OperationsRemoteRepository } from './data/operations.remote';

// Application — TanStack Query hooks + live-query wiring
export {
	operationsKeys,
	useLedger,
	useLedgerByItem,
	useStockBalance,
	useReceiveStock,
	useDistributeStock,
	useAdjustStock,
	useCampaigns,
	useStockLedgers,
	useDonations,
	useCreateCampaign,
	useReceiveWalkInDonation,
	useUpdateCampaign,
	usePurchases,
	useCreatePurchase,
	useUpdatePurchase,
	useReceivePurchase,
	useTransfers,
	useTransfer,
	useCreateTransfer,
	useDispatchTransfer,
	useReceiveTransfer,
	useCancelTransfer,
	useCrossShelterStockBalances,
	useCrossShelterLedger,
	startOperationsLiveQuery
} from './application/queries';
export { useDonationNeedsBoard } from './application/use-donation-needs-board.svelte';
export type { NeedItem } from './application/need-item.types';

// UI components
export { default as ReceiveStockForm } from './ui/receive-stock-form.svelte';
export { default as DistributeStockForm } from './ui/distribute-stock-form.svelte';
export { default as LedgerTable } from './ui/ledger-table.svelte';
export { default as StockTable } from './ui/stock-table.svelte';
export { default as AdjustStockForm } from './ui/adjust-stock-form.svelte';
export { default as PurchaseForm } from './ui/PurchaseForm.svelte';
export { default as PurchaseReceiptForm } from './ui/PurchaseReceiptForm.svelte';
export { default as PurchaseTable } from './ui/PurchaseTable.svelte';
export { default as TransferForm } from './ui/transfer-form.svelte';
export { default as TransferList } from './ui/transfer-list.svelte';
