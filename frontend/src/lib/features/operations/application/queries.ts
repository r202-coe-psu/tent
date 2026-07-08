import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { operationsRepository } from '../data/operations.remote';
import type { ReceiveInput } from '../domain/operations';

export const operationsKeys = {
	all: ['operations'] as const,
	ledger: () => [...operationsKeys.all, 'ledger'] as const,
	byItem: (id: string) => [...operationsKeys.ledger(), id] as const,
	balance: () => [...operationsKeys.all, 'balance'] as const
};

export const useLedger = (enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: operationsKeys.ledger(),
		queryFn: () => operationsRepository().listLedger(),
		enabled: enabled()
	}));

export const useLedgerByItem = (itemId: () => string | undefined) =>
	createQuery(() => ({
		queryKey: operationsKeys.byItem(itemId() ?? ''),
		queryFn: () => operationsRepository().listLedgerByItem(itemId() ?? ''),
		enabled: !!itemId()
	}));

export const useStockBalance = () =>
	createQuery(() => ({
		queryKey: operationsKeys.balance(),
		queryFn: () => operationsRepository().getBalance()
	}));

export const useReceiveStock = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ReceiveInput; ctx: AuthorContext }) =>
			operationsRepository().receiveStock(input, ctx)
	}));

export function startOperationsLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (type === 'stock_ledger') {
			return [operationsKeys.all];
		}
		return [];
	});
}
