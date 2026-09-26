/**
 * Loan return & CR-134 bulk pool mutations (Workflows 11–14):
 * returnLoanAtCounter, clearLoanNonPhysical, createBulkReturnPool, clearLoanViaBulkPool.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { resolveAuthenticatedAuthorContext, resolveShelterCode } from './shared';
import {
	invalidateDistributionLogs,
	invalidateTicket,
	invalidateShiftReconciliation,
	invalidateBulkPools,
	invalidateBulkClaims,
	invalidateInventoryQueries
} from './invalidation';
import type {
	DistributionLog,
	BulkReturnPool,
	BulkReturnClaim,
	LoanReturnReservation
} from '../../domain/food-supplies';
import {
	returnLoanAtCounter,
	clearLoanNonPhysical,
	createBulkReturnPool,
	clearLoanViaBulkPool,
	abortAbandonedReturnReservation,
	type CounterReturnInput,
	type NonPhysicalClearInput,
	type CreateBulkPoolInput,
	type ClearLoanViaBulkPoolInput
} from '../food-supplies/return-workflow';

export interface ReturnLoanMutationInput {
	logId: string;
	input: CounterReturnInput;
	ticketId?: string;
	shelterCode?: string;
}

export interface ClearLoanMutationInput {
	logId: string;
	input: NonPhysicalClearInput;
	ticketId?: string;
	shelterCode?: string;
}

export interface CreateBulkPoolMutationInput {
	input: CreateBulkPoolInput;
	shelterCode?: string;
}

export interface ClearLoanViaBulkPoolMutationInput {
	input: ClearLoanViaBulkPoolInput;
	ticketId?: string;
	shelterCode?: string;
}

/**
 * 11. returnLoanAtCounter
 * Receives physical loan item return at frontline counter: writes inbound StockLedger.
 */
export const useReturnLoanAtCounter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			logId,
			input,
			shelterCode
		}: ReturnLoanMutationInput): Promise<{ log: DistributionLog; ledgerEntryCreated: boolean }> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return returnLoanAtCounter(logId, input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode, variables.logId);
			invalidateInventoryQueries(queryClient);
			queryClient.invalidateQueries({
				queryKey: ['return-operation-state', shelterCode, variables.logId]
			});
			if (variables.ticketId) {
				invalidateTicket(queryClient, shelterCode, variables.ticketId);
				invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
			}
		}
	}));
};

/**
 * 12. clearLoanNonPhysical
 * Writes off a lost or waived item loan without physical stock changes.
 */
export const useClearLoanNonPhysical = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			logId,
			input,
			shelterCode
		}: ClearLoanMutationInput): Promise<DistributionLog> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return clearLoanNonPhysical(logId, input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode, variables.logId);
			queryClient.invalidateQueries({
				queryKey: ['return-operation-state', shelterCode, variables.logId]
			});
			if (variables.ticketId) {
				invalidateTicket(queryClient, shelterCode, variables.ticketId);
				invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
			}
		}
	}));
};

/**
 * 13. createBulkReturnPool
 * Opens an aggregate bulk drop-off pool: writes single upfront StockLedger receipt.
 * CRITICAL: Requires a caller-owned stable `input.operationUlid` reused across retries.
 */
export const useCreateBulkReturnPool = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			input,
			shelterCode
		}: CreateBulkPoolMutationInput): Promise<BulkReturnPool> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return createBulkReturnPool(input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateBulkPools(queryClient, shelterCode);
			invalidateInventoryQueries(queryClient);
		}
	}));
};

/**
 * 14. clearLoanViaBulkPool
 * Clears an evacuee loan against bulk pool quota at exit gate (CR-134 Proposed).
 * CRITICAL: Requires a caller-owned stable `input.operationUlid` reused across retries.
 */
export const useClearLoanViaBulkPool = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			input,
			shelterCode
		}: ClearLoanViaBulkPoolMutationInput): Promise<{
			pool: BulkReturnPool;
			claim: BulkReturnClaim;
			log: DistributionLog;
		}> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return clearLoanViaBulkPool(input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateBulkPools(queryClient, shelterCode, variables.input.poolId);
			invalidateDistributionLogs(queryClient, shelterCode, variables.input.logId);
			invalidateBulkClaims(queryClient, shelterCode);
			queryClient.invalidateQueries({
				queryKey: ['return-operation-state', shelterCode, variables.input.logId]
			});
			if (variables.ticketId) {
				invalidateTicket(queryClient, shelterCode, variables.ticketId);
				invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
			}
		}
	}));
};

export interface AbortAbandonedReservationMutationInput {
	logId: string;
	ticketId?: string;
	shelterCode?: string;
}

/**
 * Aborts an abandoned return reservation (CR-134 R4).
 * Enforces objective abandonment lease / caller authority and checks for irreversible side effects.
 */
export const useAbortAbandonedReturnReservation = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			logId,
			shelterCode
		}: AbortAbandonedReservationMutationInput): Promise<LoanReturnReservation> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return abortAbandonedReturnReservation(logId, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode, variables.logId);
			invalidateBulkClaims(queryClient, shelterCode);
			queryClient.invalidateQueries({
				queryKey: ['return-operation-state', shelterCode, variables.logId]
			});
			if (variables.ticketId) {
				invalidateTicket(queryClient, shelterCode, variables.ticketId);
			}
		}
	}));
};
