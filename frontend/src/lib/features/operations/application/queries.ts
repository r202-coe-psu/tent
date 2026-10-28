import {
	createMutation,
	createQuery,
	keepPreviousData,
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
	DonationSlot,
	CampaignInput,
	ReceiveInput,
	AdjustInput,
	TransferInput,
	TransferFilter,
	StockTransfer,
	Donation,
	WalkInDonationInput,
	DispatchInfoInput,
	CancelInfoInput,
	DisputeInfoInput
} from '../domain/operations';
import { catalogKeys } from '$lib/features/catalog';
import type { MergeItemsInput } from '../domain/item-merge';
import type { DonationBatchLine } from '../domain/donation-batch';
import type { CycleCountSubmission } from '../domain/cycle-count';
import { countPendingTransfers } from '../domain/transfer-pending';
import { labelledLedgerRefIds, ledgerRefLabels } from '../domain/ledger-ref';
import { digestRefIds, resolveLedgerRefLabels, type LedgerRefLabels } from './ledger-ref-labels';
import { retryUnlessForbidden } from './transfer-retry';
import { distributeBatch } from './distribute-batch';
import type { BatchLinePlan } from '../domain/distribute-batch';

/**
 * Keys for data read out of ONE shelter's database carry that shelter's code, like
 * `balance` already did. Without it SH001 and SH002 shared a cache entry: switching
 * shelter remounted the donation page onto the previous shelter's campaigns (still
 * inside `staleTime`), and a promote/cut-off clicked on that list was written into the
 * newly selected shelter's database as a stray copy.
 */
export const operationsKeys = {
	all: ['operations'] as const,
	campaigns: () => [...operationsKeys.all, 'campaigns', getShelterCode()] as const,
	stockLedgers: () => [...operationsKeys.all, 'stockLedgers', getShelterCode()] as const,
	donations: () => [...operationsKeys.all, 'donations', getShelterCode()] as const,
	ledger: () => [...operationsKeys.all, 'ledger'] as const,
	byItem: (id: string) => [...operationsKeys.ledger(), id] as const,
	ledgerRefs: () => [...operationsKeys.all, 'ledgerRefs', getShelterCode()] as const,
	ledgerRefsFor: (idsDigest: string) => [...operationsKeys.ledgerRefs(), idsDigest] as const,
	balance: () => [...operationsKeys.all, 'balance', getShelterCode()] as const,
	donationSlots: () => [...operationsKeys.all, 'donationSlots', getShelterCode()] as const,
	transfers: () => [...operationsKeys.all, 'transfers'] as const,
	transfer: (id: string) => [...operationsKeys.transfers(), id] as const,
	transferDestinations: () =>
		[...operationsKeys.all, 'transferDestinations', getShelterCode()] as const
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
		queryFn: () => operationsRepository().listDonations(),
		// svelte-query v6 only notifies for props it has seen read ("tracked props"), and
		// reads are lazy. A consumer that gates UI on `isSuccess` / `isError` inside a
		// conditional block can read a prop for the first time AFTER the transition, and
		// is then handed a stale snapshot that never refreshes. Track every prop.
		notifyOnChangeProps: 'all'
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

/**
 * Queue windows this shelter has configured (DN-5 · schema.md §2.13).
 *
 * Named for the schedule, not the public board: `useDonationSlots` in
 * `$lib/features/donations` is the donor-facing availability read through the BFF,
 * while this one is staff reading their own CouchDB.
 */
export const useDonationSlotSchedule = () =>
	createQuery(() => ({
		queryKey: operationsKeys.donationSlots(),
		queryFn: () => operationsRepository().listDonationSlots()
	}));

/**
 * Create or edit one window. `_id` is deterministic per date + start time, so the
 * same call serves both — the repository merges the current `_rev` before writing.
 */
export const useSaveDonationSlot = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (slot: DonationSlot) => operationsRepository().updateDonationSlot(slot),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.donationSlots() });
		}
	}));
};

/** Delete one window; the repository refuses while it has bookings. */
export const useDeleteDonationSlot = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (slot: DonationSlot) => operationsRepository().deleteDonationSlot(slot),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.donationSlots() });
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

/**
 * Readable labels for ledger `ref_id`s (#811); ids without one fall back to `shortLedgerRef`.
 * Keyed on a digest of the ids, and ids an earlier key already resolved come from the cache.
 */
export const useLedgerRefLabels = (refIds: () => readonly string[]) => {
	const queryClient = useQueryClient();
	return createQuery(() => {
		const ids = labelledLedgerRefIds(refIds());
		const shelterKey = operationsKeys.ledgerRefs();
		return {
			queryKey: operationsKeys.ledgerRefsFor(digestRefIds(ids)),
			queryFn: () =>
				resolveLedgerRefLabels(
					ids,
					queryClient
						.getQueriesData<LedgerRefLabels>({ queryKey: shelterKey })
						.map(([, labels]) => labels),
					async (missing) =>
						ledgerRefLabels(await operationsRepository().listLedgerRefDocs(missing))
				),
			enabled: ids.length > 0,
			placeholderData: keepPreviousData
		};
	});
};

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
 * Mutation hook for receiving every line of a donation ticket at once (CR-143 §B).
 *
 * A partly written receipt RESOLVES (it is data for the form, not an error), so the
 * caches are refreshed on settle either way: the rows that landed already count
 * towards on-hand and out of the reserved total (FR-B9).
 */
export const useReceiveDonationBatch = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			donation,
			lines,
			ctx
		}: {
			donation: Donation;
			lines: readonly DonationBatchLine[];
			ctx: AuthorContext;
		}) => operationsRepository().receiveDonationBatch(donation, lines, ctx),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
};

/**
 * Mutation hook for saving a whole cycle count at once (#347). A partly written
 * count RESOLVES (it is data for the form, not an error), so the caches are
 * refreshed on settle either way: rows that landed already count towards on-hand.
 */
export const useApplyCycleCount = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ submission, ctx }: { submission: CycleCountSubmission; ctx: AuthorContext }) =>
			operationsRepository().applyCycleCount(submission, ctx),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
};

/**
 * Mutation hook to issue several items under one `ref_id` (#837): one `distributeAcrossLots`
 * per line, no rollback. Resolves with per-line outcomes when a row fails — read
 * `result.outcomes` / `.complete`. The caches are refetched before it resolves, even on a
 * partial run (earlier rows already landed), so the retry plans from fresh balances.
 */
export const useDistributeBatch = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			lines,
			ref_id,
			note,
			ctx
		}: {
			lines: readonly BatchLinePlan[];
			ref_id: string;
			note: string;
			ctx: AuthorContext;
		}) => distributeBatch(operationsRepository(), lines, ref_id, note, ctx),
		onSettled: () => queryClient.invalidateQueries({ queryKey: operationsKeys.all })
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
 * Mutation hook to merge a duplicate item into another (CR-143 §F). Stock and catalog caches
 * both change: the source's balance moves to the destination and the source is deactivated.
 */
export const useMergeItems = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: MergeItemsInput; ctx: AuthorContext }) =>
			operationsRepository().mergeItems(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: operationsKeys.all });
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

/**
 * Shelters the active shelter may send a transfer to (#570) — every shelter but its own, for
 * the roles the transfer API accepts. Shelters change rarely, so it is kept fresh for a while.
 */
export const useTransferDestinations = () =>
	createQuery(() => ({
		queryKey: operationsKeys.transferDestinations(),
		queryFn: () => operationsRepository().listTransferDestinations(),
		staleTime: 5 * 60_000
	}));

/**
 * Query hook to list transfers (source or destination) for the active shelter (CR-059 Flow 1 / T-13).
 */
export const useTransfers = (filter?: TransferFilter) =>
	createQuery(() => ({
		queryKey: operationsKeys.transfers(),
		queryFn: () => operationsRepository().listTransfers(filter),
		retry: retryUnlessForbidden
	}));

/**
 * Number of transfers waiting on THIS shelter (tab badge). Shares `useTransfers`'
 * cache entry (same key, unfiltered), so it adds no request beside `TransferList`.
 */
export const usePendingTransferCount = () =>
	createQuery(() => ({
		queryKey: operationsKeys.transfers(),
		queryFn: () => operationsRepository().listTransfers(),
		retry: retryUnlessForbidden,
		select: (transfers: StockTransfer[]) => countPendingTransfers(transfers, getShelterCode())
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
		return [];
	});
}
