import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import { shelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { operationsRepository } from '../data/operations.pouch';
import type { ReceiveInput } from '../domain/operations';

export const operationsKeys = {
    all: ['operations'] as const,
    ledger: () => [...operationsKeys.all, 'ledger'] as const,
    balance: () => [...operationsKeys.all, 'balance'] as const
};

export const useLedger = () =>
    createQuery(() => ({
        queryKey: operationsKeys.ledger(),
        queryFn: () => operationsRepository().listLedger()
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

export function startOperationsLiveQuery(queryClient: QueryClient): LiveQueryHandle {
    return startLiveQuery(shelterDb(), queryClient, (type) => {
        switch (type) {
            case 'stock_ledger':
                return [operationsKeys.ledger(), operationsKeys.balance()];
            default:
                return [];
        }
    });
}
