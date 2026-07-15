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
import type { AuditAction } from '$lib/features/shared';
import { operationsRepository } from '../data/operations.remote';
import type {
	DonationCampaign,
	CampaignInput,
	ReceiveInput,
	DistributeInput,
	TransferInput,
	StockTransfer
} from '../domain/operations';
import { toast } from 'svelte-sonner';

export const operationsKeys = {
	all: ['operations'] as const,
	campaigns: () => [...operationsKeys.all, 'campaigns'] as const,
	stockLedgers: () => [...operationsKeys.all, 'stockLedgers'] as const,
	donations: () => [...operationsKeys.all, 'donations'] as const,
	ledger: () => [...operationsKeys.all, 'ledger'] as const,
	byItem: (id: string) => [...operationsKeys.ledger(), id] as const,
	balance: () => [...operationsKeys.all, 'balance'] as const,
	transfers: () => [...operationsKeys.all, 'transfers'] as const,
	incomingTransfers: () => [...operationsKeys.transfers(), 'incoming'] as const
};

export const useCampaigns = () =>
	createQuery(() => ({
		queryKey: operationsKeys.campaigns(),
		queryFn: () => operationsRepository().listCampaigns()
	}));

export const useStockLedgers = () =>
	createQuery(() => ({
		queryKey: operationsKeys.stockLedgers(),
		queryFn: () => operationsRepository().listLedger()
	}));

export const useDonations = () =>
	createQuery(() => ({
		queryKey: operationsKeys.donations(),
		queryFn: () => operationsRepository().listDonations()
	}));

export const useCreateCampaign = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: CampaignInput; ctx: AuthorContext }) =>
			operationsRepository().createCampaign(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.campaigns() });
		}
	}));
};

export const useUpdateCampaign = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			campaign,
			auditInput
		}: {
			campaign: DonationCampaign;
			auditInput?: { action: AuditAction; reason: string; ctx: AuthorContext };
		}) => operationsRepository().updateCampaign(campaign, auditInput),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.campaigns() });
		}
	}));
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
 * Query hook to retrieve incoming transfers.
 */
export const useIncomingTransfers = () =>
	createQuery(() => ({
		queryKey: operationsKeys.incomingTransfers(),
		queryFn: () => operationsRepository().listIncomingTransfers()
	}));

/**
 * Mutation hook to receive a transfer and record the inbound stock.
 */
export const useReceiveTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			transfer,
			receivedItems,
			ctx
		}: {
			transfer: StockTransfer;
			receivedItems: { item_id: string; qty: string | number }[];
			ctx: AuthorContext;
		}) => {
			return operationsRepository().receiveTransfer(transfer, receivedItems, ctx);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		},
		onError: (err: unknown) => {
			console.error('[operations] receiveTransfer failed:', err);
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการรับพัสดุ');
		}
	}));
};

/**
 * Starts a live query changes feed for operations (Stock Ledger, Campaign, Donation,
 * and Transfer documents). Automatically invalidates active queries when database
 * changes happen.
 */
export function startOperationsLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (type === 'donation_campaign') {
			return [operationsKeys.campaigns()];
		}
		if (type === 'stock_ledger') {
			return [operationsKeys.stockLedgers(), operationsKeys.ledger(), operationsKeys.balance()];
		}
		if (type === 'donation') {
			return [operationsKeys.donations()];
		}
		if (type === 'stock_transfer') {
			return [operationsKeys.transfers(), operationsKeys.incomingTransfers()];
		}
		return [];
	});
}
