import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb, getShelterCode } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { ticketRepository } from '../data/ticket.remote';
import type { CreateTicketInput, RequisitionTicket, TicketItemInput } from '../domain/ticket';

export const ticketKeys = {
	all: ['tickets'] as const,
	list: () => [...ticketKeys.all, 'list', getShelterCode()] as const,
	byMealPlan: (mealPlanId: string) =>
		[...ticketKeys.all, 'by_meal_plan', getShelterCode(), mealPlanId] as const,
	detail: (id: string) => [...ticketKeys.all, 'detail', getShelterCode(), id] as const
};

export const useTickets = () =>
	createQuery(() => ({
		queryKey: ticketKeys.list(),
		queryFn: () => ticketRepository().listTickets()
	}));

export const useTicket = (id: () => string | undefined) =>
	createQuery(() => {
		const ticketId = id();
		return {
			queryKey: ticketKeys.detail(ticketId ?? ''),
			queryFn: () => (ticketId ? ticketRepository().getTicketById(ticketId) : null),
			enabled: !!ticketId
		};
	});

export const useActiveTicketByMealPlanId = (mealPlanId: () => string | undefined) =>
	createQuery(() => {
		const planId = mealPlanId();
		return {
			queryKey: ticketKeys.byMealPlan(planId ?? ''),
			queryFn: () => (planId ? ticketRepository().getActiveTicketByMealPlanId(planId) : null),
			enabled: !!planId
		};
	});

export const useCreateTicket = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: CreateTicketInput; ctx: AuthorContext }) =>
			ticketRepository().createTicket(input, ctx)
	}));

export const useAllocateTicketItem = () =>
	createMutation(() => ({
		mutationFn: ({
			ticket,
			itemId,
			allocatedQty
		}: {
			ticket: RequisitionTicket;
			itemId: string;
			allocatedQty: string;
		}) => ticketRepository().allocateTicketItem(ticket, itemId, allocatedQty)
	}));

export const useUpdateTicketItems = () =>
	createMutation(() => ({
		mutationFn: ({ ticket, items }: { ticket: RequisitionTicket; items: TicketItemInput[] }) =>
			ticketRepository().updateTicketItems(ticket, items)
	}));

export const useOneStepApproveTicket = () =>
	createMutation(() => ({
		mutationFn: ({ ticket, ctx }: { ticket: RequisitionTicket; ctx: AuthorContext }) =>
			ticketRepository().oneStepApproveTicket(ticket, ctx)
	}));

export const useApproveTicket = () =>
	createMutation(() => ({
		mutationFn: ({ ticket, ctx }: { ticket: RequisitionTicket; ctx: AuthorContext }) =>
			ticketRepository().approveTicket(ticket, ctx)
	}));

export const useDispatchTicket = () =>
	createMutation(() => ({
		mutationFn: ({ ticket, ctx }: { ticket: RequisitionTicket; ctx: AuthorContext }) =>
			ticketRepository().dispatchTicket(ticket, ctx)
	}));

export const useReceiveTicket = () =>
	createMutation(() => ({
		mutationFn: ({ ticket, ctx }: { ticket: RequisitionTicket; ctx: AuthorContext }) =>
			ticketRepository().receiveTicket(ticket, ctx)
	}));

export const useCancelTicket = () =>
	createMutation(() => ({
		mutationFn: ({ ticket, reason }: { ticket: RequisitionTicket; reason?: string }) =>
			ticketRepository().cancelTicket(ticket, reason)
	}));

export function startTicketsLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		switch (type) {
			case 'requisition_ticket':
				return [ticketKeys.all];
			default:
				return [];
		}
	});
}
