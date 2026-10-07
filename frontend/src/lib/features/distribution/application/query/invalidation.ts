/**
 * Reusable cache invalidation helpers for post-mutation authoritative refresh.
 * Guarantees precise invalidation without broad, blind cache purges.
 */

import type { QueryClient } from '@tanstack/svelte-query';
import { operationsKeys } from '$lib/features/operations';
import { distributionKeys } from './keys';

/** Invalidates all ticket lists within the shelter. */
export function invalidateTicketCollection(queryClient: QueryClient, shelterCode: string): void {
	queryClient.invalidateQueries({
		queryKey: [...distributionKeys.shelter(shelterCode), 'tickets']
	});
}

/** Invalidates a specific ticket detail. */
export function invalidateTicket(
	queryClient: QueryClient,
	shelterCode: string,
	ticketId: string
): void {
	queryClient.invalidateQueries({
		queryKey: distributionKeys.ticket(shelterCode, ticketId)
	});
}

/** Invalidates both the specific ticket and the ticket lists (for state transitions & quantity changes). */
export function invalidateTicketWithCollection(
	queryClient: QueryClient,
	shelterCode: string,
	ticketId: string
): void {
	invalidateTicket(queryClient, shelterCode, ticketId);
	invalidateTicketCollection(queryClient, shelterCode);
}

/** Invalidates distribution logs, optionally invalidating a specific log item. */
export function invalidateDistributionLogs(
	queryClient: QueryClient,
	shelterCode: string,
	logId?: string
): void {
	if (logId) {
		queryClient.invalidateQueries({
			queryKey: distributionKeys.log(shelterCode, logId)
		});
	}
	queryClient.invalidateQueries({
		queryKey: [...distributionKeys.shelter(shelterCode), 'logs']
	});
}

/** Invalidates the live shift reconciliation calculation for a ticket. */
export function invalidateShiftReconciliation(
	queryClient: QueryClient,
	shelterCode: string,
	ticketId: string
): void {
	queryClient.invalidateQueries({
		queryKey: distributionKeys.shiftReconciliation(shelterCode, ticketId)
	});
}

/** Invalidates bulk return pools, optionally invalidating a specific pool. */
export function invalidateBulkPools(
	queryClient: QueryClient,
	shelterCode: string,
	poolId?: string
): void {
	if (poolId) {
		queryClient.invalidateQueries({
			queryKey: distributionKeys.bulkPool(shelterCode, poolId)
		});
	}
	queryClient.invalidateQueries({
		queryKey: [...distributionKeys.shelter(shelterCode), 'bulk_pools']
	});
}

/** Invalidates bulk return claims, optionally invalidating a specific claim. */
export function invalidateBulkClaims(
	queryClient: QueryClient,
	shelterCode: string,
	claimId?: string
): void {
	if (claimId) {
		queryClient.invalidateQueries({
			queryKey: distributionKeys.bulkClaim(shelterCode, claimId)
		});
	}
	queryClient.invalidateQueries({
		queryKey: [...distributionKeys.shelter(shelterCode), 'bulk_claims']
	});
}

/** Invalidates operations feature stock ledgers, ledger log, and balance queries. */
export function invalidateInventoryQueries(queryClient: QueryClient): void {
	queryClient.invalidateQueries({ queryKey: operationsKeys.stockLedgers() });
	queryClient.invalidateQueries({ queryKey: operationsKeys.ledger() });
	queryClient.invalidateQueries({ queryKey: operationsKeys.balance() });
}
