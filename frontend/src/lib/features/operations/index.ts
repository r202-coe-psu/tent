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
	DonationSlotMode,
	NeedAvailability,
	StockLotBalance,
	StockTransfer,
	StockTransferItem,
	TransferInput,
	TransferFilter,
	DispatchInfoInput,
	CancelInfoInput,
	DisputeInfoInput
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
	keyDonationReceipt,
	receiveDonation,
	expireDonation,
	canTransitionDonation,
	stockBalance,
	openNeeds,
	calculateReserved,
	keyedDonationIds,
	recordedDonationQty,
	keyableDonations,
	completeDonationReceipt,
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
	distributionReturnInputSchema,
	createDistributionReturnEntry,
	type DistributionReturnInput,
	projectStockLotBalances,
	sortStockLotsByConsumptionOrder,
	StockLotIntegrityError,
	adjustInputSchema,
	createAdjustEntry,
	adjustReasonSchema,
	manualAdjustReasonSchema,
	MANUAL_ADJUST_REASONS,
	ADJUST_NOTE_MAX_LENGTH,
	resolveAdjustReason,
	STOCK_LEDGER_SCHEMA_V,
	type AdjustInput,
	type AdjustReason,
	type ManualAdjustReason,
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
export {
	formatThaiDuration,
	formatAgeInStock,
	formatTimeSinceProduced,
	formatTimeUntilExpiry,
	formatLotClockLine,
	formatItemAgeLine,
	summarizeItemLotAge,
	ageInStockMs,
	timeSinceProducedMs,
	timeUntilExpiryMs,
	type ItemLotAgeSummary
} from './domain/lot-age';
export {
	ItemMergeError,
	checkItemMerge,
	planItemMerge,
	type ItemMergeCheckInput,
	type ItemMergeErrorCode,
	type ItemMergeLeg,
	type ItemMergePlan,
	type ItemMergeResult,
	type MergeItemsInput,
	type PlanItemMergeInput
} from './domain/item-merge';
export {
	deriveDonationReceiptLineId,
	donationShortfall,
	isReceivedLine,
	type DonationBatchLine,
	type DonationBatchLineResult,
	type DonationBatchLineState,
	type DonationBatchResult,
	type DonationShortfall
} from './domain/donation-batch';
export {
	buildCycleCountLots,
	groupLotsByStorage,
	classifyCycleCount,
	cycleCountVariance,
	planCycleCount,
	summarizeCycleCount,
	type CycleCountEntry,
	type CycleCountLot,
	type CycleCountResult,
	type CycleCountSubmission,
	type StorageGroup
} from './domain/cycle-count';
export { countPendingTransfers, isTransferPending } from './domain/transfer-pending';
export { deriveDeterministicLedgerId } from './domain/deterministic-ledger-id';
export {
	DEFAULT_STORAGE_LABEL,
	lotStorageName,
	lotStorageLabel,
	lotStorageKey,
	lotLocationFields,
	storageLotFields,
	type StoragePointRef
} from './domain/lot-storage';

// Domain — donation queue slots (DN-5 · schema.md §2.13)
export {
	assertDonationSlotDeletable,
	bookingQueue,
	countSlotBookings,
	createDonationSlot,
	editDonationSlot,
	donationSlotId,
	donationSlotInputSchema,
	parseCapacityInput,
	slotDates,
	slotMode,
	slotsOnDate,
	type DonationSlotInput
} from './domain/donation-slot';

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
	useDistributeAcrossLots,
	useAdjustStock,
	useMergeItems,
	useCampaigns,
	useStockLedgers,
	useDonations,
	useCreateCampaign,
	useDonationSlotSchedule,
	useSaveDonationSlot,
	useDeleteDonationSlot,
	useReceiveWalkInDonation,
	useReceiveDonationBatch,
	useApplyCycleCount,
	useUpdateCampaign,
	useTransfers,
	useTransfer,
	usePendingTransferCount,
	useCreateTransfer,
	useDispatchTransfer,
	useReceiveTransfer,
	useCancelTransfer,
	useDisputeTransfer,
	useResumeTransfer,
	useCrossShelterStockBalances,
	useCrossShelterLedger,
	startOperationsLiveQuery
} from './application/queries';
export { useDonationNeedsBoard } from './application/use-donation-needs-board.svelte';
export { useStoragePoints } from './application/use-storage-points.svelte';
export { useStockFormItems } from './application/use-stock-form-items.svelte';
export {
	toStockFormItems,
	filterStockFormItems,
	type StockFormItem
} from './domain/stock-form-items';
export type { NeedItem } from './application/need-item.types';

// UI components
export { default as ReceiveStockForm } from './ui/receive-stock-form.svelte';
export { default as DistributeStockForm } from './ui/distribute-stock-form.svelte';
export { default as LedgerTable } from './ui/ledger-table.svelte';
export { default as StockTable } from './ui/stock-table.svelte';
/** Query keys owned by the stock table — the page strips them when leaving the stock tab. */
export { STOCK_PARAM_KEYS } from './ui/stock/stock-url-state';
/** Query keys owned by the movements tab — the page strips them when leaving it. */
export { LEDGER_PARAM_KEYS } from './ui/ledger/ledger-url-state';
export { default as AdjustStockForm } from './ui/adjust-stock-form.svelte';
export { default as CycleCountForm } from './ui/cycle-count-form.svelte';
export { default as MergeItemDialog } from './ui/merge-item-dialog.svelte';
export { default as ItemCombobox } from './ui/item-combobox.svelte';
export { default as StoragePointSelect } from './ui/storage-point-select.svelte';
export { default as TransferForm } from './ui/transfer-form.svelte';
export { default as TransferList } from './ui/transfer-list.svelte';
export { default as TransferTab } from './ui/transfer-tab.svelte';

export {
	rankLotsForIssue,
	scoreLot,
	isLotExpired,
	lotPriorityReason,
	toLotPriorityItems,
	URGENT_DAYS,
	W_EXPIRY,
	W_AGE,
	HORIZON_DAYS,
	type LotPriorityItem,
	type LotScore,
	type RankLotsOptions
} from './domain/lot-priority';
export {
	planLotSplit,
	type LotAllocation,
	type LotSplitPlan,
	type SplittableLot
} from './domain/lot-split';
export type {
	DistributeAcrossLotsResult,
	DistributedLot,
	FailedLot
} from './application/distribute-across-lots';
