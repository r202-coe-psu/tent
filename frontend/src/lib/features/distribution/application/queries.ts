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
	invalidateBulkPools,
	invalidateBulkClaims,
	invalidateInventoryQueries
} from './query/invalidation';

// Read queries
export {
	useRequisitionTickets,
	useRequisitionTicket,
	useDistributionLogs,
	useDistributionLog,
	useBulkReturnPools,
	useBulkReturnPool,
	useBulkReturnClaim,
	useShiftReconciliation
} from './query/read-queries';

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
	useClearLoanViaBulkPool,
	type ReturnLoanMutationInput,
	type ClearLoanMutationInput,
	type CreateBulkPoolMutationInput,
	type ClearLoanViaBulkPoolMutationInput
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
