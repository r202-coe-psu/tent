/**
 * Ticket lifecycle mutation hooks (Workflows 1–7):
 * create, allocate, approve, cancel, dispatch, receive, amend.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { resolveAuthenticatedAuthorContext, resolveShelterCode } from './shared';
import {
	invalidateTicketCollection,
	invalidateTicketWithCollection,
	invalidateInventoryQueries
} from './invalidation';
import type { RequisitionTicket, RequisitionTicketInput } from '../../domain/food-supplies';
import {
	createRequisitionTicket,
	allocateTicketItems,
	approveTicketForDispatch,
	cancelTicket,
	receiveTicketAtDistributionPoint,
	type ItemAllocationInput
} from '../food-supplies/ticket-workflow';
import {
	dispatchTicket,
	amendActiveTicket,
	type DispatchTicketOptions,
	type InFlightAmendmentInput
} from '../food-supplies/dispatch-workflow';

export interface CreateTicketMutationInput {
	input: RequisitionTicketInput;
	shelterCode?: string;
}

export interface AllocateItemsMutationInput {
	ticketId: string;
	allocations: ItemAllocationInput[];
	shelterCode?: string;
}

export interface TicketIdMutationInput {
	ticketId: string;
	shelterCode?: string;
}

export interface CancelTicketMutationInput {
	ticketId: string;
	reason: string;
	shelterCode?: string;
}

export interface DispatchTicketMutationInput {
	ticketId: string;
	options?: DispatchTicketOptions;
	shelterCode?: string;
}

export interface AmendTicketMutationInput {
	ticketId: string;
	input: InFlightAmendmentInput;
	shelterCode?: string;
}

/**
 * 1. createRequisitionTicket
 * Creates a new food or supplies requisition ticket stopping strictly at PENDING_PICK.
 */
export const useCreateRequisitionTicket = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			input,
			shelterCode
		}: CreateTicketMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return createRequisitionTicket(input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketCollection(queryClient, shelterCode);
		}
	}));
};

/**
 * 2. allocateTicketItems
 * Warehouse staff records picked/allocated quantities on a PENDING_PICK ticket.
 */
export const useAllocateTicketItems = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			allocations,
			shelterCode
		}: AllocateItemsMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return allocateTicketItems(ticketId, allocations, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 3. approveTicketForDispatch
 * Managerial approval: validates allocations and transitions PENDING_PICK -> READY_FOR_DISPATCH.
 */
export const useApproveTicketForDispatch = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			shelterCode
		}: TicketIdMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return approveTicketForDispatch(ticketId, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 4. cancelTicket
 * Cancels a ticket prior to dispatch (PENDING_PICK or READY_FOR_DISPATCH).
 */
export const useCancelTicket = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			reason,
			shelterCode
		}: CancelTicketMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return cancelTicket(ticketId, reason, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 5. dispatchTicket
 * Dispatches cargo from warehouse: writes outbound StockLedger entries and transitions to IN_TRANSIT.
 */
export const useDispatchTicket = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			options,
			shelterCode
		}: DispatchTicketMutationInput): Promise<{
			ticket: RequisitionTicket;
			ledgerEntriesCreated: number;
		}> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return dispatchTicket(ticketId, options, ctx);
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
 * 6. receiveTicketAtDistributionPoint
 * Frontline confirms physical cargo arrival: transitions IN_TRANSIT -> DISTRIBUTING.
 */
export const useReceiveTicketAtDistributionPoint = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			ticketId,
			shelterCode
		}: TicketIdMutationInput): Promise<RequisitionTicket> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return receiveTicketAtDistributionPoint(ticketId, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
		}
	}));
};

/**
 * 7. amendActiveTicket
 * In-flight top-up during active distribution.
 * CRITICAL: Requires caller-owned stable `input.amendmentId` reused across retries.
 */
export const useAmendActiveTicket = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ ticketId, input, shelterCode }: AmendTicketMutationInput) => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return amendActiveTicket(ticketId, input, ctx);
		},
		retry: false,
		onSuccess: (_data, variables) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateTicketWithCollection(queryClient, shelterCode, variables.ticketId);
			invalidateInventoryQueries(queryClient);
		}
	}));
};
