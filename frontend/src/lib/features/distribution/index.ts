/** Public API for CR-059 Flow 2 (Distribution). */

export {
	activeHeadcountSchema,
	bufferPercentSchema,
	approvalCoverageSchema,
	distributionRequestStatusSchema,
	distributionRequestItemSchema,
	distributionRequestInputSchema,
	distributionRequestDocSchema,
	validateRequestItemsDuplicateCompatibility,
	canTransitionDistributionRequest,
	calculateApprovalCoverage,
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
	isDistributionIssue,
	distributionIssueIdempotencyInputSchema,
	distributionIssueIdempotencyDocSchema,
	createDistributionIssueIdempotency,
	issueCapacityPendingClaimSchema,
	distributionIssueCapacityInputSchema,
	distributionIssueCapacityDocSchema,
	createDistributionIssueCapacity,
	oneTimeGuardPendingClaimSchema,
	distributionOneTimeGuardInputSchema,
	distributionOneTimeGuardDocSchema,
	createDistributionOneTimeGuard,
	stockLotPendingClaimSchema,
	stockLotReservationInputSchema,
	stockLotReservationDocSchema,
	createStockLotReservation,
	nfiTargetInputSchema,
	calculateNfiTarget,
	type DistributionRequestStatus,
	type ApprovalCoverage,
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
	type DistributionIssueIdempotencyInput,
	type DistributionIssueIdempotency,
	type IssueCapacityPendingClaim,
	type DistributionIssueCapacityInput,
	type DistributionIssueCapacity,
	type OneTimeGuardPendingClaim,
	type DistributionOneTimeGuardInput,
	type DistributionOneTimeGuard,
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

export {
	type DistributionAllocationInput,
	type CreateDistributionIssueInput,
	type DistributionRecipient,
	type DistributionRepository
} from './data/distribution.repository';

export { DistributionRemoteRepository } from './data/distribution.remote';

export {
	distributionKeys,
	useDistributionRequests,
	useDistributionBatches,
	useDistributionRequest,
	useDistributionBatch,
	useCreateDistributionRequest,
	useApproveDistributionRequest,
	useRejectDistributionRequest,
	useCancelDistributionRequest
} from './application/queries';

export { default as DistributionPage } from './ui/distribution-page.svelte';
export { default as CreateRequestDialog } from './ui/create-request-dialog.svelte';
export { default as RequestItemEditor } from './ui/request-item-editor.svelte';
export { default as NfiTemplatePicker } from './ui/nfi-template-picker.svelte';
export { default as ApprovalDialog } from './ui/approval-dialog.svelte';
export { default as PhysicalLotSelector } from './ui/physical-lot-selector.svelte';
export { default as RequestDetailDialog } from './ui/request-detail-dialog.svelte';
export { default as RejectRequestDialog } from './ui/reject-request-dialog.svelte';
export { default as ActiveBatchSummary } from './ui/active-batch-summary.svelte';
export {
	getLotInputKey,
	filterLotsForItem,
	calculateItemAllocation,
	buildApprovalPlan,
	validateApprovalPlan,
	buildApprovalAllocations,
	type AllocationItemStatus,
	type LotAllocationEntry,
	type ItemAllocationPlan,
	type ApprovalPlanValidation
} from './ui/approval-allocation-form';
export {
	ALLOWED_BUFFER_PERCENTS,
	DEFAULT_BUFFER_PERCENT,
	NFI_TEMPLATE_PRESETS,
	catalogDistributionTypeToSnapshot,
	createInitialFormItem,
	createInitialFormState,
	validateCreateRequestForm,
	type AllowedBufferPercent,
	type CreateRequestFormItem,
	type CreateRequestFormState,
	type NfiTemplatePreset,
	type FormValidationResult
} from './ui/create-request-form';

export {
	IntegrityError,
	ApprovalConflictError,
	InsufficientStockError,
	ValidationError,
	IssueConflictError,
	IssueCapacityError,
	RecipientNotActiveError,
	DistributionEligibilityError,
	makeLotReservationDocId,
	makeIssueIdempotencyDocId,
	makeIssueCapacityDocId,
	makeOneTimeGuardDocId,
	assertSemanticLedgerMatch,
	assertSemanticBatchMatch,
	assertSemanticIdempotencyMatch,
	assertSemanticIssueMatch
} from './data/semantic-verify';
