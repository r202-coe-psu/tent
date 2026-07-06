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
	DonationChannel
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
	isStockLedger,
	isDonation,
	isDonationCampaign,
	type StockLedgerInput,
	type ReceiveInput,
	type WalkInDonationInput,
	type CampaignInput,
	type SpecialRequestInput
} from './domain/operations';

// Data — repository contract + PouchDB binding
export type { OperationsRepository } from './data/operations.repository';
export { operationsRepository } from './data/operations.pouch';

// Application — TanStack Query hooks + live-query wiring
export {
	operationsKeys,
	useLedger,
	useStockBalance,
	useReceiveStock,
	startOperationsLiveQuery
} from './application/queries';
