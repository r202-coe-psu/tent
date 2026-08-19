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
import { createWalkInDonation } from '../domain/operations';
import type {
	DonationCampaign,
	CampaignInput,
	ReceiveInput,
	DistributeInput,
	AdjustInput,
	Purchase,
	PurchaseInput,
	CountedItem,
	WalkInDonationInput
} from '../domain/operations';

export const operationsKeys = {
	all: ['operations'] as const,
	campaigns: () => [...operationsKeys.all, 'campaigns'] as const,
	stockLedgers: () => [...operationsKeys.all, 'stockLedgers'] as const,
	donations: () => [...operationsKeys.all, 'donations'] as const,
	purchases: () => [...operationsKeys.all, 'purchases'] as const,
	ledger: () => [...operationsKeys.all, 'ledger'] as const,
	byItem: (id: string) => [...operationsKeys.ledger(), id] as const,
	balance: () => [...operationsKeys.all, 'balance'] as const
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

export const usePurchases = () =>
	createQuery(() => ({
		queryKey: operationsKeys.purchases(),
		queryFn: () => operationsRepository().listPurchases()
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
 * Mutation hook that mints a walk-in donation document (CR-055 R4 / D-1).
 *
 * Goods that arrive without a booking have no donation doc to point at, so the
 * receive form's picker would be empty and the stock could not be keyed at all.
 * This creates the missing source document first; the caller then uses the
 * returned `_id` as the ledger's `ref_id`.
 */
export const useCreateWalkInDonation = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: WalkInDonationInput; ctx: AuthorContext }) =>
			operationsRepository().createDonation(createWalkInDonation(input, ctx)),
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
 * Mutation hook to adjust stock (manual writes/adjusts) and invalidate caches.
 */
export const useAdjustStock = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: AdjustInput; ctx: AuthorContext }) =>
			operationsRepository().adjustStock(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
};

/**
 * Mutation hook to declare a procurement record (CR-032 step 1). Creates no
 * stock — the receipt is keyed separately via {@link useReceivePurchase}.
 */
export const useCreatePurchase = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: PurchaseInput; ctx: AuthorContext }) =>
			operationsRepository().createPurchase(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.purchases() });
		}
	}));
};

/**
 * Mutation hook to correct a purchase that has not been received yet. The
 * repository refuses the write once any receipt has been keyed (CR-032).
 */
export const useUpdatePurchase = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ purchase }: { purchase: Purchase }) =>
			operationsRepository().updatePurchase(purchase),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.purchases() });
		}
	}));
};

/**
 * Mutation hook to key a counted purchase receipt into stock (CR-032 step 2).
 * Invalidates the whole feature because it appends ledger rows, which move the
 * balance as well as the purchase's received state.
 */
export const useReceivePurchase = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			purchase,
			counted,
			ctx
		}: {
			purchase: Purchase;
			counted: CountedItem[];
			ctx: AuthorContext;
		}) => operationsRepository().receivePurchase(purchase, counted, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
};

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
		if (type === 'purchase') {
			return [operationsKeys.purchases()];
		}
		return [];
	});
}
