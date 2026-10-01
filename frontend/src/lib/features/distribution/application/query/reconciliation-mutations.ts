/**
 * Shift reconciliation & warehouse return mutations (Workflows 16–19):
 * closeShift, submitReturnsToWarehouse, receiveWarehouseReturns, completeTicket.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { resolveAuthenticatedAuthorContext, resolveShelterCode } from './shared';
import {
	invalidateTicketWithCollection,
	invalidateShiftReconciliation,
	invalidateInventoryQueries
} from './invalidation';
import type { RequisitionTicket } from '../../domain/food-supplies';
import {
	closeShift,
	submitReturnsToWarehouse,
	receiveWarehouseReturns,
	completeTicket,
	type ShiftCloseOptions,
	type VerifiedWarehouseReturns
} from '../food-supplies/reconciliation-workflow';

export interface CloseShiftMutationInput {
	ticketId: string;
	options?: ShiftCloseOptions;
	shelterCode?: string;
}

export interface SubmitReturnsMutationInput {
	ticketId: string;
	shelterCode?: string;
}

export interface ReceiveWarehouseReturnsMutationInput {
	ticketId: string;
	options?: VerifiedWarehouseReturns;
	shelterCode?: string;
}

export interface CompleteTicketMutationInput {
	ticketId: string;
	shelterCode?: string;
}

/**
 * 16. closeShift
 * Closes frontline shift and reconciles stock.
 * Auto-transitions to COMPLETED if returns = 0; transitions to SHIFT_CLOSED if returns remain.
 */
export const useCloseShift = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			options,
			shelterCode
		}: CloseShiftMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return closeShift(ticketId, options, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
			invalidateShiftReconciliation(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 17. submitReturnsToWarehouse
 * Dispatches remaining physical goods back to warehouse (SHIFT_CLOSED -> RETURN_PENDING_RECEIPT).
 */
export const useSubmitReturnsToWarehouse = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			shelterCode
		}: SubmitReturnsMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return submitReturnsToWarehouse(ticketId, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 18. receiveWarehouseReturns
 * Warehouse dockside verification of physical returns: writes inbound StockLedger (reason='receive')
 * and marks ticket RETURN_COMPLETED.
 */
export const useReceiveWarehouseReturns = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			options,
			shelterCode
		}: ReceiveWarehouseReturnsMutationInput): Promise<{
			ticket: RequisitionTicket;
			ledgerEntriesCreated: number;
		}> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return receiveWarehouseReturns(ticketId, options, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
			invalidateInventoryQueries(queryClient);
		}
	}));
};

/**
 * 19. completeTicket
 * Final closeout of ticket from RETURN_COMPLETED -> COMPLETED (or application recovery from SHIFT_CLOSED).
 */
export const useCompleteTicket = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			shelterCode
		}: CompleteTicketMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return completeTicket(ticketId, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
		}
	}));
};
