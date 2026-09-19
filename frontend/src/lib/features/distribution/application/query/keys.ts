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
	shiftReconciliation: (shelterCode: string, ticketId: string) =>
		[...distributionKeys.shelter(shelterCode), 'shift_reconciliation', ticketId] as const
};
