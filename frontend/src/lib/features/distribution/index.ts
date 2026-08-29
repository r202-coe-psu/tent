/** Public domain API for CR-059 Flow 2. Persistence and UI land in later phases. */

export {
	activeHeadcountSchema,
	bufferPercentSchema,
	distributionRequestStatusSchema,
	distributionRequestItemSchema,
	distributionRequestInputSchema,
	distributionRequestDocSchema,
	canTransitionDistributionRequest,
	canEditDistributionRequest,
	createDistributionRequest,
	distributionBatchStatusSchema,
	distributionBatchItemSchema,
	distributionLotSnapshotSchema,
	distributionAllocationSchema,
	distributionBatchInputSchema,
	distributionBatchDocSchema,
	canTransitionDistributionBatch,
	createDistributionBatch,
	distributionIssueInputSchema,
	distributionIssueDocSchema,
	createDistributionIssue,
	stockLotPendingClaimSchema,
	stockLotReservationInputSchema,
	stockLotReservationDocSchema,
	createStockLotReservation,
	nfiTargetInputSchema,
	calculateNfiTarget,
	type DistributionRequestStatus,
	type DistributionRequestItem,
	type DistributionRequestInput,
	type DistributionRequest,
	type DistributionBatchStatus,
	type DistributionBatchItem,
	type DistributionAllocation,
	type DistributionBatchInput,
	type DistributionBatch,
	type DistributionIssueInput,
	type DistributionIssue,
	type StockLotPendingClaim,
	type StockLotReservationInput,
	type StockLotReservation,
	type NfiTargetInput
} from './domain/distribution';

export {
	distributionTypeSnapshotSchema,
	repeatOverrideReasonSchema,
	eligibilityHistoryEntrySchema,
	eligibilityInputSchema,
	eligibilitySnapshotSchema,
	evaluateDistributionEligibility,
	type DistributionTypeSnapshot,
	type RepeatOverrideReason,
	type EligibilityHistoryEntry,
	type EligibilityInput,
	type EligibilitySnapshot
} from './domain/eligibility';

export {
	reconciliationInputSchema,
	reconciliationRowSchema,
	calculateReconciliation,
	ReconciliationIntegrityError,
	type ReconciliationInput,
	type ReconciliationRow
} from './domain/reconciliation';
