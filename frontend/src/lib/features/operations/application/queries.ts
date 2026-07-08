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
import { getShelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { operationsRepository } from '../data/operations.remote';
import type { ReceiveInput, DistributeInput } from '../domain/operations';
import { toast } from 'svelte-sonner';

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

/**
 * Mutation hook to receive inbound stock and persist the ledger entry.
 * Cache invalidation is handled by `startOperationsLiveQuery` via the changes feed.
 */
export const useReceiveStock = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ReceiveInput; ctx: AuthorContext }) =>
			operationsRepository().receiveStock(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		},
		onError: (err: unknown) => {
			console.error('[operations] receiveStock failed:', err);
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการรับของเข้าคลัง');
		}
	}));
};

/**
 * Mutation hook to distribute outbound stock, persist the ledger entry, and invalidate caches.
 */
export const useDistributeStock = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: DistributeInput; ctx: AuthorContext }) =>
			operationsRepository().distributeStock(input, ctx),
		onSuccess: () => {
			// Eagerly invalidate — live query will also fire, but this ensures instant update
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		},
		onError: (err: unknown) => {
			console.error('[operations] distributeStock failed:', err);
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแจกจ่ายพัสดุ');
		}
	}));
};

export function startOperationsLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (type === 'stock_ledger') {
			return [operationsKeys.all];
		}
		return [];
	});
}
