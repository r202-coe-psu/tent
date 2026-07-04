import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import { shelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { operationsRepository } from '../data/operations.pouch';
import type { ReceiveInput, DistributeInput, TransferInput } from '../domain/operations';
import { toast } from 'svelte-sonner';

export const operationsKeys = {
	all: ['operations'] as const,
	ledger: () => [...operationsKeys.all, 'ledger'] as const,
	byItem: (id: string) => [...operationsKeys.ledger(), id] as const,
	balance: () => [...operationsKeys.all, 'balance'] as const
};

/**
 * Query hook to retrieve all stock ledger entries.
 */
export const useLedger = () =>
	createQuery(() => ({
		queryKey: operationsKeys.ledger(),
		queryFn: () => operationsRepository().listLedger()
	}));

/**
 * Query hook to retrieve stock ledger entries filtered by a specific item.
 */
export const useLedgerByItem = (itemId: () => string) =>
	createQuery(() => ({
		queryKey: operationsKeys.byItem(itemId()),
		queryFn: () => operationsRepository().listLedgerByItem(itemId())
	}));

/**
 * Query hook to retrieve the current on-hand stock balances (Map of itemId -> quantity).
 */
export const useStockBalance = () =>
	createQuery(() => ({
		queryKey: operationsKeys.balance(),
		queryFn: () => operationsRepository().getBalance()
	}));

/**
 * Mutation hook to receive inbound stock, persist the ledger entry, and invalidate caches.
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

/**
 * Mutation hook to create and immediately dispatch a transfer to another shelter.
 */
export const useCreateAndDispatchTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ input, ctx }: { input: TransferInput; ctx: AuthorContext }) => {
			const repo = operationsRepository();
			const transfer = await repo.createTransfer(input, ctx);
			return repo.dispatchTransfer(transfer, ctx);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		},
		onError: (err: unknown) => {
			console.error('[operations] createAndDispatchTransfer failed:', err);
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างรายการโอน');
		}
	}));
};

/**
 * Starts a live query changes feed for operations (Stock Ledger documents).
 * Automatically invalidates active queries when database changes happen.
 */
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
