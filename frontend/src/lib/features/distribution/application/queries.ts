/**
 * Phase 5 Slice 5.0 — Distribution Query Layer Facade.
 *
 * Re-exports centralized query keys, read queries, mutation hooks for all 19 workflows,
 * invalidation helpers, and live-query subscriptions from modular query subpackages.
 */

// Low-level utilities & context
export {
	type MaybeGetter,
	toValue,
	resolveShelterCode,
	createStableOperationId,
	resolveAuthenticatedAuthorContext
} from './query/shared';

// Centralized query key factory
export { distributionKeys } from './query/keys';

// Repository factories
export {
	requisitionTicketRepository,
	distributionLogRepository,
	bulkReturnPoolRepository,
	bulkReturnClaimRepository
} from './query/repositories';

// Invalidation helpers
export {
	invalidateTicketCollection,
	invalidateTicket,
	invalidateTicketWithCollection,
	invalidateDistributionLogs,
	invalidateShiftReconciliation,
	invalidateBulkPoolsV3,
	invalidateReturnerOutstandingLoans,
	invalidateBulkClaims,
	invalidateInventoryQueries
} from './query/invalidation';

// Read queries
export {
	useRequisitionTickets,
	useRequisitionTicket,
	useDistributionLogs,
	useDistributionLog,
	useDispatchedLotExpiry,
	useBulkReturnPools,
	useBulkReturnPool,
	useBulkReturnPoolOverview,
	useBulkReturnPoolClosedLoanRefs,
	useBulkReturnPoolMissedLoanRefs,
	useBulkReturnPoolTimeline,
	useBulkReturnPoolAppliedLoanRefs,
	useReturnerOutstandingLoans,
	useBulkReturnSkippedDocs,
	useShiftReconciliation,
	useReturnOperationState
} from './query/read-queries';

// Bulk return pool v3 mutations (issue #659)
export {
	useOpenBulkReturnPool,
	useUpdateBulkReturnPoolHeader,
	useAddBulkReturnEntries,
	useMoveBulkReturnEntry,
	useApplyMissedBulkReturnLoanRefs,
	useVoidBulkReturnEntry,
	useCancelBulkReturnPool,
	useSubmitBulkReturnPool,
	useReceiveBulkReturnPool,
	type ApplyMissedBulkReturnLoanRefsMutationInput,
	type OpenBulkReturnPoolMutationInput,
	type UpdateBulkReturnPoolHeaderMutationInput,
	type AddBulkReturnEntriesMutationInput,
	type MoveBulkReturnEntryMutationInput,
	type VoidBulkReturnEntryMutationInput,
	type CancelBulkReturnPoolMutationInput,
	type SubmitBulkReturnPoolMutationInput,
	type ReceiveBulkReturnPoolMutationInput
} from './query/bulk-pool-v3-mutations';

// Imperative read: which add-entry operationUlids already wrote an entry (retry of a partial save)
export { findWrittenBulkReturnEntries } from './food-supplies/bulk-return-pool-v3-add-entry';

// Ticket lifecycle mutations (Workflows 1–7)
export {
	useCreateRequisitionTicket,
	useAllocateTicketItems,
	useApproveTicketForDispatch,
	useCancelTicket,
	useDispatchTicket,
	useReceiveTicketAtDistributionPoint,
	useAmendActiveTicket,
	type CreateTicketMutationInput,
	type AllocateItemsMutationInput,
	type TicketIdMutationInput,
	type CancelTicketMutationInput,
	type DispatchTicketMutationInput,
	type AmendTicketMutationInput
} from './query/ticket-mutations';

// Frontline distribution & handover mutations (Workflows 8–10)
export {
	useRecordFoodDistribution,
	useRecordSuppliesDistribution,
	useVoidDistributionLog,
	type FoodDistributionMutationInput,
	type SuppliesDistributionMutationInput,
	type VoidLogMutationInput
} from './query/distribution-mutations';

// Loan return & bulk pool mutations (Workflows 11–14)
export {
	useReturnLoanAtCounter,
	useClearLoanNonPhysical,
	useCreateBulkReturnPool,
	useAbortAbandonedReturnReservation,
	type ReturnLoanMutationInput,
	type ClearLoanMutationInput,
	type AbortAbandonedReservationMutationInput
} from './query/return-mutations';

// Shift reconciliation & warehouse return mutations (Workflows 16–19)
export {
	useCloseShift,
	useSubmitReturnsToWarehouse,
	useReceiveWarehouseReturns,
	useCompleteTicket,
	type CloseShiftMutationInput,
	type SubmitReturnsMutationInput,
	type ReceiveWarehouseReturnsMutationInput,
	type CompleteTicketMutationInput
} from './query/reconciliation-mutations';

// CouchDB changes subscriber
export { startDistributionLiveQuery } from './query/live-query';

// Re-export domain summary type for UI consumers
export type { ItemReconciliationSummary } from './food-supplies/reconciliation-workflow';
