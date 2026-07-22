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
	OperationsDoc,
	LedgerReason,
	DonationStatus,
	TransferStatus,
	DonationChannel,
	DonationSlot,
	NeedAvailability
} from './domain/operations';

// Domain — schemas + factories + transitions + read models + guards
export {
	ledgerReasonSchema,
	donationStatusSchema,
	transferStatusSchema,
	donationChannelSchema,
	stockLedgerInputSchema,
	receiveInputSchema,
	walkInDonationInputSchema,
	campaignInputSchema,
	specialRequestSchema,
	createStockLedger,
	createWalkInDonation,
	createCampaign,
	keyDonationReceipt,
	receiveDonation,
	expireDonation,
	canTransitionDonation,
	stockBalance,
	openNeeds,
	calculateReserved,
	isNeedCutOff,
	deriveNeedAvailability,
	isStockLedger,
	isDonation,
	isDonationCampaign,
	isDonationSlot,
	mapNeedItemHeuristic,
	type StockLedgerInput,
	type ReceiveInput,
	type WalkInDonationInput,
	type CampaignInput,
	type SpecialRequestInput,
	receiveSourceSchema,
	createReceiveEntry,
	distributeInputSchema,
	createDistributeEntry,
	type DistributeInput
} from './domain/operations';

// Data — repository contract + remote CouchDB binding
export type { OperationsRepository } from './data/operations.repository';
export { operationsRepository } from './data/operations.remote';

// Application — TanStack Query hooks + live-query wiring
export {
	operationsKeys,
	useLedger,
	useLedgerByItem,
	useStockBalance,
	useReceiveStock,
	useDistributeStock,
	useCampaigns,
	useStockLedgers,
	useDonations,
	useCreateCampaign,
	useUpdateCampaign,
	startOperationsLiveQuery
} from './application/queries';
export { useDonationNeedsBoard } from './application/use-donation-needs-board.svelte';
export type { NeedItem } from './application/need-item.types';

// UI components
export { default as ReceiveStockForm } from './ui/ReceiveStockForm.svelte';
export { default as DistributeStockForm } from './ui/DistributeStockForm.svelte';
export { default as LedgerTable } from './ui/LedgerTable.svelte';
export { default as StockTable } from './ui/stock-table.svelte';
