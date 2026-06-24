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
	isNeedCutOff,
	isStockLedger,
	isDonation,
	isDonationCampaign,
	type StockLedgerInput,
	type WalkInDonationInput,
	type CampaignInput,
	type SpecialRequestInput
} from './domain/operations';

// Data layer — repositories
export {
	operationsRepository,
	shelterDb,
	SHELTER_CODE
} from './data/operations.pouch';
// Application — queries
export {
	operationsKeys,
	useCampaigns,
	useStockLedgers,
	useDonations,
	useCreateCampaign,
	useUpdateCampaign,
	startOperationsLiveQuery
} from './application/queries';