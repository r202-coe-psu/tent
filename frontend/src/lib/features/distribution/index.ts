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
	distributionIssueIdSchema,
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
	distributionIssueGateStateSchema,
	issueGatePendingClaimSchema,
	distributionIssueGateInputSchema,
	distributionIssueGateDocSchema,
	createDistributionIssueGate,
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
	type DistributionIssueGateState,
	type IssueGatePendingClaim,
	type DistributionIssueGateInput,
	type DistributionIssueGate,
	type OneTimeGuardPendingClaim,
	type DistributionOneTimeGuardInput,
	type DistributionOneTimeGuard,
	type StockLotPendingClaim,
	type StockLotReservationInput,
	type StockLotReservation,
	type NfiTargetInput
} from './domain/distribution';

/** Ticket-era Flow 2 domain contracts (CR-121). Legacy Flow 2 exports above remain read-compatible. */
export {
	requisitionTypeSchema,
	flow2RequisitionTypeSchema,
	requisitionTicketStatusSchema,
	mealPeriodSchema,
	ticketItemSchema,
	ticketAmendmentSchema,
	requisitionTicketInputSchema,
	requisitionTicketDocSchema,
	createFlow2RequisitionTicket,
	isFlow2RequisitionTicket,
	assertFlow2RequisitionTicket,
	canTransitionRequisitionTicket,
	assertRequisitionTicketTransition,
	assertRequisitionTicketMutation,
	distributionRecipientTypeSchema,
	distributionLogStatusSchema,
	returnConditionSchema,
	loanClearReasonSchema,
	distributionLogInputSchema,
	distributionLogDocSchema,
	createDistributionLog,
	assertDistributionLogIssuanceImmutable,
	bulkReturnPoolStatusSchema,
	bulkReturnPoolInputSchema,
	bulkReturnPoolDocSchema,
	createBulkReturnPool,
	type RequisitionType,
	type Flow2RequisitionType,
	type RequisitionTicketStatus,
	type MealPeriod,
	type TicketItem,
	type TicketAmendment,
	type RequisitionTicketInput,
	type RequisitionTicket,
	type Flow2RequisitionTicket,
	type DistributionRecipientType,
	type DistributionLogStatus,
	type DistributionLogInput,
	type DistributionLog,
	type BulkReturnPoolStatus,
	type BulkReturnPoolInput,
	type BulkReturnPool
} from './domain/food-supplies';

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
	closeBatchItemInputSchema,
	closeBatchInputSchema,
	type ReconciliationInput,
	type ReconciliationRow,
	type CloseBatchItemInput,
	type CloseBatchInput
} from './domain/reconciliation';

export {
	type DistributionAllocationInput,
	type CreateDistributionIssueInput,
	type DistributionRecipient,
	type DistributionRepository
} from './data/distribution.repository';

export { DistributionRemoteRepository } from './data/distribution.remote';

export {
	IntegrityError,
	ApprovalConflictError,
	InsufficientStockError,
	ValidationError,
	IssueConflictError,
	IssueCapacityError,
	IssueInFlightError,
	BatchClosingConflictError,
	RecipientNotActiveError,
	DistributionEligibilityError,
	makeLotReservationDocId,
	makeIssueIdempotencyDocId,
	makeIssueCapacityDocId,
	makeIssueGateDocId,
	makeOneTimeGuardDocId,
	assertSemanticLedgerMatch,
	assertSemanticBatchMatch,
	assertSemanticReservationMatch,
	assertSemanticIdempotencyMatch,
	assertEligibilitySnapshotInvariant,
	assertSemanticIssueMatch,
	assertSemanticClosingMatch
} from './data/semantic-verify';

/** Ticket-era Flow 2 persistence repositories (CR-121). Legacy DistributionRemoteRepository above remains intact. */
export {
	RequisitionTicketRemoteRepository,
	DistributionLogRemoteRepository,
	BulkReturnPoolRemoteRepository,
	type RequisitionTicketRepository,
	type RequisitionTicketListFilter,
	type RequisitionTicketTransitionPatch,
	type DistributionLogRepository,
	type DistributionLogListFilter,
	type RecordReturnInput,
	type RecordClearInput,
	type BulkReturnPoolRepository,
	type BulkReturnPoolListFilter
} from './data/food-supplies';

/** Ticket-era Food & Supplies application workflows (CR-121). */
export * from './application/food-supplies';

/** Ticket-era Food & Supplies TanStack Query hooks & query keys (Slice 5.0). */
export {
	distributionKeys,
	createStableOperationId,
	resolveAuthenticatedAuthorContext,
	requisitionTicketRepository,
	distributionLogRepository,
	bulkReturnPoolRepository,
	bulkReturnClaimRepository,
	useRequisitionTickets,
	useRequisitionTicket,
	useDistributionLogs,
	useDistributionLog,
	useBulkReturnPools,
	useBulkReturnPool,
	useBulkReturnClaim,
	useShiftReconciliation,
	useCreateRequisitionTicket,
	useAllocateTicketItems,
	useApproveTicketForDispatch,
	useCancelTicket,
	useDispatchTicket,
	useReceiveTicketAtDistributionPoint,
	useAmendActiveTicket,
	useRecordFoodDistribution,
	useRecordSuppliesDistribution,
	useVoidDistributionLog,
	useReturnLoanAtCounter,
	useClearLoanNonPhysical,
	useCreateBulkReturnPool,
	useClearLoanViaBulkPool,
	useCloseShift,
	useSubmitReturnsToWarehouse,
	useReceiveWarehouseReturns,
	useCompleteTicket,
	startDistributionLiveQuery,
	type ItemReconciliationSummary
} from './application/queries';

/** Ticket-era Food & Supplies UI components & models (Slice 5.1). */
export { default as TicketStatusBadge } from './ui/common/TicketStatusBadge.svelte';
export { default as TicketManagementPage } from './ui/back-office/TicketManagementPage.svelte';
export { default as BulkPoolManager } from './ui/back-office/BulkPoolManager.svelte';
export { default as CreateBulkPoolDialog } from './ui/back-office/CreateBulkPoolDialog.svelte';
export { default as TicketGroupTabs } from './ui/back-office/TicketGroupTabs.svelte';
export { default as TicketTable } from './ui/back-office/TicketTable.svelte';
export { default as TicketFilters } from './ui/back-office/TicketFilters.svelte';
export { default as CreateTicketDialog } from './ui/back-office/CreateTicketDialog.svelte';
export { default as CatalogItemPicker } from './ui/back-office/CatalogItemPicker.svelte';

export {
	REQUISITION_TICKET_STATUSES,
	TICKET_STATUS_LABELS,
	TICKET_STATUS_BADGE_CLASSES,
	getTicketStatusLabel,
	getTicketStatusBadgeClass,
	REQUISITION_TYPE_LABELS,
	getRequisitionTypeLabel,
	MEAL_PERIOD_LABELS,
	getMealPeriodLabel
} from './ui/model/ticket-status';

export {
	WORKFLOW_GROUPS,
	WORKFLOW_GROUP_MAP,
	matchesWorkflowGroup,
	getWorkflowGroupForStatus,
	computeTicketGroupCounts,
	filterRequisitionTickets,
	type TicketWorkflowGroupId,
	type WorkflowGroupDefinition,
	type TicketGroupCounts,
	type TicketFilterOptions
} from './ui/model/ticket-filters';

export {
	READY_MEAL_CATEGORY_ID,
	READY_MEAL_SYSTEM_KEY,
	KITCHEN_FOOD_CATEGORY_ID,
	KITCHEN_FOOD_SYSTEM_KEY,
	isReadyMealCategory,
	isKitchenFoodCategory,
	isAnyFoodCategory,
	isEligibleDistributionCatalogItem,
	getReturnableBadgeLabel,
	getReturnableBadgeClass
} from './ui/model/catalog-eligibility';

/** Ticket-era Food & Supplies UI components & models (Slice 5.2). */
export { default as TicketLifecycleProgress } from './ui/common/TicketLifecycleProgress.svelte';
export { default as TicketDetailShell } from './ui/back-office/TicketDetailShell.svelte';
export { default as TicketActionPanel } from './ui/back-office/TicketActionPanel.svelte';
export { default as TicketAllocationDialog } from './ui/back-office/TicketAllocationDialog.svelte';
export { default as CancelTicketDialog } from './ui/back-office/CancelTicketDialog.svelte';

export {
	NORMAL_LIFECYCLE_SEQUENCE,
	isTicketReadyForApproval,
	isTerminalTicketStatus,
	isReturnsStageStatus,
	getLifecycleSteps,
	type LifecycleStageId,
	type StepState,
	type LifecycleStep
} from './ui/model/ticket-lifecycle';

/** Ticket-era Food & Supplies UI components & models (Slice 5.3). */
export { default as PhysicalLotPicker } from './ui/back-office/PhysicalLotPicker.svelte';
export { default as DispatchTicketDialog } from './ui/back-office/DispatchTicketDialog.svelte';

export {
	getEligiblePhysicalLots,
	isLotDateExpired,
	type EligiblePhysicalLot
} from './ui/model/physical-lot';

/** Ticket-era Food & Supplies UI components & models (Slice 5.4 — Frontline Handover). */
export { default as FrontlineStationPage } from './ui/frontline/FrontlineStationPage.svelte';
