/**
 * Frontline distribution & handover mutation hooks (Workflows 8–10):
 * recordFoodDistribution, recordSuppliesDistribution, voidDistributionLog.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { resolveAuthenticatedAuthorContext, resolveShelterCode } from './shared';
import {
	invalidateDistributionLogs,
	invalidateTicket,
	invalidateShiftReconciliation
} from './invalidation';
import type { DistributionLog } from '../../domain/food-supplies';
import {
	recordFoodDistribution,
	recordSuppliesDistribution,
	voidDistributionLog,
	type FoodDistributionInput,
	type SuppliesDistributionInput
} from '../food-supplies/distribution-workflow';
import {
	recordHouseholdMealPickup,
	type HouseholdMealPickupInput,
	type HouseholdMealPickupResult
} from '../food-supplies/household-meal-pickup-workflow';

export interface FoodDistributionMutationInput {
	ticketId: string;
	input: FoodDistributionInput;
	shelterCode?: string;
}

export interface SuppliesDistributionMutationInput {
	ticketId: string;
	input: SuppliesDistributionInput;
	shelterCode?: string;
}

export interface VoidLogMutationInput {
	logId: string;
	reason?: string;
	ticketId?: string;
	shelterCode?: string;
}

/**
 * 8. recordFoodDistribution
 * Frontline hands over meals to recipient with 4-hr cooking timer & Thailand calendar-day duplicate check.
 */
export const useRecordFoodDistribution = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			input,
			shelterCode
		}: FoodDistributionMutationInput): Promise<DistributionLog> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return recordFoodDistribution(ticketId, input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode);
			invalidateTicket(queryClient, shelterCode, variables.ticketId);
			invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

export interface HouseholdMealPickupMutationInput {
	ticketId: string;
	input: HouseholdMealPickupInput;
	shelterCode?: string;
}

/**
 * 8b. recordHouseholdMealPickup (#1154) — one member collects for several. Resolves with a
 * result per member; partial writes still land, so caches refresh on every settle.
 */
export const useRecordHouseholdMealPickup = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			input,
			shelterCode
		}: HouseholdMealPickupMutationInput): Promise<HouseholdMealPickupResult[]> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return recordHouseholdMealPickup(ticketId, input, ctx);
		},
		retry: false,
		onSettled: (_data, _error, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode);
			invalidateTicket(queryClient, shelterCode, variables.ticketId);
			invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 9. recordSuppliesDistribution
 * Frontline issues consumables (fulfilled) or returnable loans (active) with capacity checks.
 */
export const useRecordSuppliesDistribution = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			input,
			shelterCode
		}: SuppliesDistributionMutationInput): Promise<DistributionLog> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return recordSuppliesDistribution(ticketId, input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode);
			invalidateTicket(queryClient, shelterCode, variables.ticketId);
			invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 10. voidDistributionLog
 * Voids an erroneous distribution log (immutable issuance audit).
 */
export const useVoidDistributionLog = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			logId,
			reason,
			shelterCode
		}: VoidLogMutationInput): Promise<DistributionLog> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return voidDistributionLog(logId, reason, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode, variables.logId);
			if (variables.ticketId) {
				invalidateTicket(queryClient, shelterCode, variables.ticketId);
				invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
			}
		}
	}));
};
