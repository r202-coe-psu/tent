/**
 * Centralized, hierarchical, and deterministic TanStack Query key factory
 * for all Distribution feature models (CR-121 / CR-134).
 */

import type {
	RequisitionTicketListFilter,
	DistributionLogListFilter,
	BulkReturnPoolListFilter
} from '../../data/food-supplies';

export const distributionKeys = {
	all: ['distribution'] as const,
	shelter: (shelterCode: string) => [...distributionKeys.all, shelterCode] as const,
	tickets: (shelterCode: string, filter?: RequisitionTicketListFilter) =>
		[...distributionKeys.shelter(shelterCode), 'tickets', filter ?? {}] as const,
	ticket: (shelterCode: string, ticketId: string) =>
		[...distributionKeys.shelter(shelterCode), 'ticket', ticketId] as const,
	logs: (shelterCode: string, filter?: DistributionLogListFilter) =>
		[...distributionKeys.shelter(shelterCode), 'logs', filter ?? {}] as const,
	log: (shelterCode: string, logId: string) =>
		[...distributionKeys.shelter(shelterCode), 'log', logId] as const,
	bulkPools: (shelterCode: string, filter?: BulkReturnPoolListFilter) =>
		[...distributionKeys.shelter(shelterCode), 'bulk_pools', filter ?? {}] as const,
	bulkPool: (shelterCode: string, poolId: string) =>
		[...distributionKeys.shelter(shelterCode), 'bulk_pool', poolId] as const,
	bulkClaims: (shelterCode: string, filter?: { pool_id?: string; log_id?: string }) =>
		[...distributionKeys.shelter(shelterCode), 'bulk_claims', filter ?? {}] as const,
	bulkClaim: (shelterCode: string, claimId: string) =>
		[...distributionKeys.shelter(shelterCode), 'bulk_claim', claimId] as const,
	dispatchedLotExpiry: (shelterCode: string, ticketId: string, itemId: string) =>
		[...distributionKeys.shelter(shelterCode), 'dispatched_lot_expiry', ticketId, itemId] as const,
	shiftReconciliation: (shelterCode: string, ticketId: string) =>
		[...distributionKeys.shelter(shelterCode), 'shift_reconciliation', ticketId] as const,

	/** Prefix of every v3 bulk return pool overview query (invalidation / live-query). */
	bulkPoolsV3All: (shelterCode: string) =>
		[...distributionKeys.shelter(shelterCode), 'bulk_pools_v3'] as const,
	bulkPoolsV3: (shelterCode: string, options?: { includeCancelled?: boolean }) =>
		[
			...distributionKeys.bulkPoolsV3All(shelterCode),
			{ includeCancelled: Boolean(options?.includeCancelled) }
		] as const,
	/**
	 * Loan-drift warning refs of a pool. Nested under `bulkPoolsV3All` so every overview
	 * invalidation (add / move / void / ...) also refreshes it.
	 */
	bulkPoolClosedLoanRefsAll: (shelterCode: string) =>
		[...distributionKeys.bulkPoolsV3All(shelterCode), 'closed_loan_refs'] as const,
	bulkPoolClosedLoanRefs: (shelterCode: string, poolId: string) =>
		[...distributionKeys.bulkPoolClosedLoanRefsAll(shelterCode), poolId] as const,
	/** Planned-but-unapplied refs of a closed pool's entries (nested under bulkPoolsV3All like the closed one). */
	bulkPoolMissedLoanRefsAll: (shelterCode: string) =>
		[...distributionKeys.bulkPoolsV3All(shelterCode), 'missed_loan_refs'] as const,
	bulkPoolMissedLoanRefs: (shelterCode: string, poolId: string) =>
		[...distributionKeys.bulkPoolMissedLoanRefsAll(shelterCode), poolId] as const,
	/** Prefix of every pool applied-loan-refs query (nested under bulkPoolsV3All like the closed one). */
	bulkPoolAppliedLoanRefsAll: (shelterCode: string) =>
		[...distributionKeys.bulkPoolsV3All(shelterCode), 'applied_loan_refs'] as const,
	bulkPoolAppliedLoanRefs: (shelterCode: string, poolId: string) =>
		[...distributionKeys.bulkPoolAppliedLoanRefsAll(shelterCode), poolId] as const,
	/** Chronological timeline of a pool (nested under bulkPoolsV3All so overview invalidation refreshes it). */
	bulkPoolTimelineAll: (shelterCode: string) =>
		[...distributionKeys.bulkPoolsV3All(shelterCode), 'timeline'] as const,
	bulkPoolTimeline: (shelterCode: string, poolId: string) =>
		[...distributionKeys.bulkPoolTimelineAll(shelterCode), poolId] as const,
	/**
	 * Malformed docs the bulk return reads skipped; `returnerId` ('' = none) adds that returner's
	 * loans. Nested under `bulkPoolsV3All` so overview invalidation refreshes it.
	 */
	bulkReturnSkippedDocs: (shelterCode: string, returnerId = '') =>
		[...distributionKeys.bulkPoolsV3All(shelterCode), 'skipped_docs', returnerId] as const,
	/** Prefix of every returner outstanding-loans query. */
	returnerOutstandingLoansAll: (shelterCode: string) =>
		[...distributionKeys.shelter(shelterCode), 'returner_outstanding_loans'] as const,
	returnerOutstandingLoans: (shelterCode: string, returnerId: string) =>
		[...distributionKeys.returnerOutstandingLoansAll(shelterCode), returnerId] as const,

	returnOperationStates: (shelterCode: string) =>
		[...distributionKeys.shelter(shelterCode), 'return_operation_state'] as const,
	returnOperationState: (shelterCode: string, logId: string) =>
		[...distributionKeys.returnOperationStates(shelterCode), logId] as const
};
