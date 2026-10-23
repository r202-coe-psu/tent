import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb, getShelterCode } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { ticketRepository } from '../data/ticket.remote';
import { operationsKeys } from '$lib/features/operations';
import type { CreateTicketInput, RequisitionTicket, TicketItemInput } from '../domain/ticket';
import type { TicketLotAllocations } from '../domain/ticket-dispatch';

export const ticketKeys = {
	all: ['tickets'] as const,
	list: () => [...ticketKeys.all, 'list', getShelterCode()] as const,
	byMealPlan: (mealPlanId: string) =>
		[...ticketKeys.all, 'by_meal_plan', getShelterCode(), mealPlanId] as const,
	detail: (id: string) => [...ticketKeys.all, 'detail', getShelterCode(), id] as const
};

/**
 * Mutation that refreshes the writer's own UI on success instead of waiting for
 * the delayed `_changes` feed. Dispatch/receive write stock_ledger, so operations
 * is refreshed too.
 */
function ticketMutation<TData, TVariables>(mutationFn: (variables: TVariables) => Promise<TData>) {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
			void queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
}

export const useTickets = () =>
	createQuery(() => ({
		queryKey: ticketKeys.list(),
		refetchOnMount: 'always',
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
	ticketMutation(({ input, ctx }: { input: CreateTicketInput; ctx: AuthorContext }) =>
		ticketRepository().createTicket(input, ctx)
	);

export const useAllocateTicketItem = () =>
	ticketMutation(
		({
			ticket,
			itemId,
			allocatedQty
		}: {
			ticket: RequisitionTicket;
			itemId: string;
			allocatedQty: string;
		}) => ticketRepository().allocateTicketItem(ticket, itemId, allocatedQty)
	);

export const useUpdateTicketItems = () =>
	ticketMutation(({ ticket, items }: { ticket: RequisitionTicket; items: TicketItemInput[] }) =>
		ticketRepository().updateTicketItems(ticket, items)
	);

export const useApproveTicket = () =>
	ticketMutation(({ ticket, ctx }: { ticket: RequisitionTicket; ctx: AuthorContext }) =>
		ticketRepository().approveTicket(ticket, ctx)
	);

export const useApproveTicketWithAllocations = () =>
	ticketMutation(
		({
			ticket,
			allocations,
			ctx
		}: {
			ticket: RequisitionTicket;
			allocations: Record<string, string>;
			ctx: AuthorContext;
		}) => ticketRepository().approveTicketWithAllocations(ticket, allocations, ctx)
	);

export const useDispatchTicket = () =>
	ticketMutation(
		({
			ticket,
			lotsByItem,
			ctx
		}: {
			ticket: RequisitionTicket;
			lotsByItem: TicketLotAllocations;
			ctx: AuthorContext;
		}) => ticketRepository().dispatchTicket(ticket, lotsByItem, ctx)
	);

export const useReceiveTicket = () =>
	ticketMutation(({ ticket, ctx }: { ticket: RequisitionTicket; ctx: AuthorContext }) =>
		ticketRepository().receiveTicket(ticket, ctx)
	);

export const useCancelTicket = () =>
	ticketMutation(({ ticket, reason }: { ticket: RequisitionTicket; reason?: string }) =>
		ticketRepository().cancelTicket(ticket, reason)
	);

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
