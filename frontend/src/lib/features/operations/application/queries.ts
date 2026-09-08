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
import type { AuditAction } from '$lib/features/shared';
import { operationsRepository, OperationsRemoteRepository } from '../data/operations.remote';
import type {
	DonationCampaign,
	CampaignInput,
	ReceiveInput,
	DistributeInput,
	AdjustInput,
	Purchase,
	PurchaseInput,
	CountedItem,
	TransferInput,
	TransferFilter,
	WalkInDonationInput,
	DispatchInfoInput,
	CancelInfoInput,
	DisputeInfoInput
} from '../domain/operations';

export const operationsKeys = {
	all: ['operations'] as const,
	campaigns: () => [...operationsKeys.all, 'campaigns'] as const,
	stockLedgers: () => [...operationsKeys.all, 'stockLedgers'] as const,
	donations: () => [...operationsKeys.all, 'donations'] as const,
	purchases: () => [...operationsKeys.all, 'purchases'] as const,
	ledger: () => [...operationsKeys.all, 'ledger'] as const,
	byItem: (id: string) => [...operationsKeys.ledger(), id] as const,
	balance: () => [...operationsKeys.all, 'balance', getShelterCode()] as const,
	transfers: () => [...operationsKeys.all, 'transfers'] as const,
	transfer: (id: string) => [...operationsKeys.transfers(), id] as const
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

export const useCrossShelterStockBalances = (
	shelterCodes: () => string[],
	enabled: () => boolean = () => true
) =>
	createQuery(() => ({
		queryKey: ['operations', 'cross-shelter-balances', ...shelterCodes()] as const,
		queryFn: async () => {
			const codes = shelterCodes();
			const results = await Promise.all(
				codes.map(async (code) => {
					const dbName = `shelter_${code.toLowerCase()}`;
					const repo = new OperationsRemoteRepository(dbName);
					try {
						const balance = await repo.getBalance();
						return { shelterCode: code, balance };
					} catch {
						return { shelterCode: code, balance: new Map<string, string>() };
					}
				})
			);
			return results;
		},
		enabled: enabled() && shelterCodes().length > 0
	}));

export const useCrossShelterLedger = (
	shelterCodes: () => string[],
	enabled: () => boolean = () => true
) =>
	createQuery(() => ({
		queryKey: ['operations', 'cross-shelter-ledger', ...shelterCodes()] as const,
		queryFn: async () => {
			const codes = shelterCodes();
			const results = await Promise.all(
				codes.map(async (code) => {
					const dbName = `shelter_${code.toLowerCase()}`;
					const repo = new OperationsRemoteRepository(dbName);
					try {
						const ledger = await repo.listLedger();
						return ledger;
					} catch {
						return [];
					}
				})
			);
			return results.flat();
		},
		enabled: enabled() && shelterCodes().length > 0
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
 * Mutation hook for goods that arrive without a booking (CR-055 R4 / D-1).
 *
 * Mints the missing donation document AND the ledger row that references it in
 * one request, so an abandoned form cannot leave a `declared` donation behind
 * inflating reserved stock forever.
 */
export const useReceiveWalkInDonation = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			donation,
			receive,
			ctx
		}: {
			donation: WalkInDonationInput;
			receive: ReceiveInput;
			ctx: AuthorContext;
		}) => operationsRepository().receiveWalkInDonation(donation, receive, ctx),
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

/**
 * Query hook to list transfers (source or destination) for the active shelter (CR-059 Flow 1 / T-13).
 */
export const useTransfers = (filter?: TransferFilter) =>
	createQuery(() => ({
		queryKey: operationsKeys.transfers(),
		queryFn: () => operationsRepository().listTransfers(filter)
	}));

export const useTransfer = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: operationsKeys.transfer(id()),
		queryFn: () => operationsRepository().getTransfer(id()),
		enabled: enabled() && !!id()
	}));

/**
 * Mutation hook to create an inter-shelter transfer request. `stock_transfer` lives in
 * `central_ops`, not the shelter's own DB, so there is no live-query entry for it in
 * `startOperationsLiveQuery` below — cache sync is this hook's `invalidateQueries` only
 * (refetch-on-interaction, same as `referral` today; see CR-059 Decision Log 2026-08-22).
 */
export const useCreateTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: TransferInput; ctx: AuthorContext }) =>
			operationsRepository().createTransfer(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.transfers() });
		}
	}));
};

/**
 * Mutation hook to dispatch a transfer (source shelter, `requested` → `shipped`).
 * CR-089 FR-01 — the driver and plate ride along with the transition; the server rejects
 * a dispatch that arrives without them, before any stock is deducted.
 */
export const useDispatchTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, info }: { id: string; info: DispatchInfoInput }) =>
			operationsRepository().dispatchTransfer(id, info),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.transfers() });
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
};

/** Mutation hook to receive a transfer (destination shelter, `shipped` → `received`). */
export const useReceiveTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			id,
			receivedItems,
			notes
		}: {
			id: string;
			receivedItems: { item_id: string; qty: string | number }[];
			notes?: string;
		}) => operationsRepository().receiveTransfer(id, receivedItems, notes),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.transfers() });
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
};

/**
 * Mutation hook to cancel a transfer before dispatch (source shelter, `requested` → `cancelled`).
 * CR-089 FR-03 — cancelling must say why.
 */
export const useCancelTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, info }: { id: string; info: CancelInfoInput }) =>
			operationsRepository().cancelTransfer(id, info),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.transfers() });
		}
	}));
};

/**
 * Mutation hook to dispute — hold — a transfer (source shelter, `requested` → `disputed`).
 * CR-089 FR-04. No stock moves, so only the transfer list needs invalidating.
 */
export const useDisputeTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, info }: { id: string; info: DisputeInfoInput }) =>
			operationsRepository().disputeTransfer(id, info),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.transfers() });
		}
	}));
};

/**
 * Mutation hook to release the hold (source shelter, `disputed` → `requested`).
 * CR-089 FR-05 — no extra field; `dispute_reason` and `timeline.disputed` keep their last value.
 */
export const useResumeTransfer = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (id: string) => operationsRepository().resumeTransfer(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.transfers() });
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
