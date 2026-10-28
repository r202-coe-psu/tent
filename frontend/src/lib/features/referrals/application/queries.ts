import {
	createInfiniteQuery,
	createMutation,
	createQuery,
	type InfiniteData,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { getShelterCode, getShelterDb } from '$lib/db/shelter';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import {
	bulkTransitionReferrals,
	createReferralBatch,
	referralRepository
} from '../data/referral.remote';
import { BulkTransitionProgress } from './bulk-transition-progress.svelte';
import { runBulkTransition } from './bulk-transition-run';
import type {
	ReferralBulkTransitionResult,
	ReferralSubmitIntent
} from '../data/referral.repository';
import { authStore } from '$lib/stores/auth.svelte';
import type {
	Referral,
	ReferralFilter,
	ReferralDirectionFilter,
	ReferralInput,
	ReferralPage,
	ReferralStatus
} from '../domain/referral.schema';

export const referralKeys = {
	all: ['referrals'] as const,
	lists: () => [...referralKeys.all, 'list', getShelterCode()] as const,
	list: (filter?: ReferralFilter) => [...referralKeys.lists(), filter] as const,
	details: () => [...referralKeys.all, 'detail', getShelterCode()] as const,
	detail: (id: string) => [...referralKeys.details(), id] as const,
	batches: () => [...referralKeys.all, 'batch', getShelterCode()] as const,
	batch: (id: string) => [...referralKeys.all, 'batch', getShelterCode(), id] as const
};

export type ReferralPagesParams = {
	direction: ReferralDirectionFilter;
	status?: ReferralStatus;
	sort?: ReferralFilter['sort'];
};

/** Next bookmark to fetch, or `undefined` when the last page was reached. */
export const getNextReferralPageParam = (last: ReferralPage): string | undefined =>
	last.hasMore ? (last.bookmark ?? undefined) : undefined;

/** Replace `updated` inside every cached page of an infinite referral list. */
export function replaceReferralInPages(
	old: InfiniteData<ReferralPage, string | undefined> | undefined,
	updated: Referral
): InfiniteData<ReferralPage, string | undefined> | undefined {
	if (!old?.pages) return old;
	return {
		...old,
		pages: old.pages.map((page) => ({
			...page,
			items: page.items.map((r) => (r._id === updated._id ? updated : r))
		}))
	};
}

/** Server-paged referral list for one direction (+ optional status), loaded via `bookmark`. */
export const useReferralPages = (params: () => ReferralPagesParams) =>
	createInfiniteQuery(() => {
		const { direction, status, sort } = params();
		const filter: ReferralFilter = { direction, status, sort };
		return {
			queryKey: referralKeys.list(filter),
			initialPageParam: undefined as string | undefined,
			queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
				referralRepository().listPage({ ...filter, bookmark: pageParam }),
			getNextPageParam: getNextReferralPageParam
		};
	});

export const useReferral = (id: () => string, enabled: () => boolean = () => true) => {
	const queryClient = useQueryClient();
	return createQuery(() => {
		const seed = id() ? findCachedReferral(queryClient, id()) : undefined;
		return {
			queryKey: referralKeys.detail(id()),
			queryFn: () => referralRepository().get(id()),
			enabled: enabled() && !!id(),
			initialData: seed?.data,
			initialDataUpdatedAt: seed?.updatedAt
		};
	});
};

/** Batch members of the referral `id` (its siblings created in the same 2-minute window). */
export const useReferralBatch = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: referralKeys.batch(id()),
		queryFn: () => referralRepository().getBatch(id()),
		enabled: enabled() && !!id()
	}));

/**
 * Seed for the detail query: the referral from any cached infinite list page, with the time that
 * list was fetched so the query still refetches in the background when stale.
 */
export function findCachedReferral(
	queryClient: QueryClient,
	id: string
): { data: Referral; updatedAt: number } | undefined {
	const lists = queryClient.getQueriesData<InfiniteData<ReferralPage, string | undefined>>({
		queryKey: referralKeys.lists()
	});
	let best: { data: Referral; updatedAt: number } | undefined;
	for (const [key, data] of lists) {
		const found = data?.pages.flatMap((p) => p.items).find((r) => r._id === id);
		if (!found) continue;
		const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
		if (!best || updatedAt > best.updatedAt) best = { data: found, updatedAt };
	}
	return best;
}

export const useCreateReferral = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: ReferralInput) =>
			referralRepository().create(input, {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

export const useCreateReferralBatch = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({
			template,
			evacueeIds,
			intent
		}: {
			template: ReferralInput;
			evacueeIds: string[];
			intent: ReferralSubmitIntent;
		}) =>
			createReferralBatch(template, evacueeIds, {
				intent,
				ctx: {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				}
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

export const useTransitionReferral = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({ id, to, reason }: { id: string; to: ReferralStatus; reason?: string }) =>
			referralRepository().transition(id, to, authStore.user?.name ?? 'unknown', reason),
		onSuccess: (updatedDoc) => {
			// 1. Update detail cache instantly
			queryClient.setQueryData(referralKeys.detail(updatedDoc._id), updatedDoc);

			// 2. Update list caches (if any exist) — replace matching doc with updated
			queryClient.setQueriesData<InfiniteData<ReferralPage, string | undefined>>(
				{ queryKey: referralKeys.lists() },
				(old) => replaceReferralInPages(old, updatedDoc)
			);

			// 3. Background invalidate to ensure eventual consistency with CouchDB sync
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

/** Patch the updated docs into the detail, list and batch caches without refetching. */
export function patchReferralCaches(queryClient: QueryClient, updated: Referral[]) {
	for (const doc of updated) {
		queryClient.setQueryData(referralKeys.detail(doc._id), doc);
		queryClient.setQueriesData<InfiniteData<ReferralPage, string | undefined>>(
			{ queryKey: referralKeys.lists() },
			(old) => replaceReferralInPages(old, doc)
		);
		queryClient.setQueriesData<Referral[]>({ queryKey: referralKeys.batches() }, (old) =>
			old?.map((r) => (r._id === doc._id ? doc : r))
		);
	}
}

export type BulkTransitionVars = { ids: string[]; to: ReferralStatus; reason?: string };

/**
 * Bulk transition (CR-167): ids go to `POST bulk-transition` in chunks of 200, one request at a
 * time. `progress` is reactive state for "สำเร็จ n / N" and the per-item failures; successes are
 * never rolled back. Caches are patched with the returned docs and invalidated once per run (F-08).
 */
export function useBulkTransition(queryClient: QueryClient) {
	const progress = new BulkTransitionProgress();

	const mutation = createMutation(() => ({
		mutationFn: ({ ids, to, reason }: BulkTransitionVars) =>
			runBulkTransition({
				ids,
				to,
				reason,
				send: bulkTransitionReferrals,
				onChunk: (r) => progress.addChunk(r.succeeded.length, r.failed)
			}),
		onSuccess: (result: ReferralBulkTransitionResult) => {
			patchReferralCaches(queryClient, result.succeeded);
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

	async function run(ids: string[], to: ReferralStatus, reason?: string) {
		progress.start(ids.length, to, reason);
		try {
			return await mutation.mutateAsync({ ids, to, reason });
		} finally {
			progress.finish();
		}
	}

	/** Resend only the ids that failed in the last run, with the same target and reason. */
	async function retryFailed() {
		const ids = progress.failed.map((f) => f.id);
		if (ids.length === 0 || !progress.to) return undefined;
		progress.beginRetry();
		try {
			return await mutation.mutateAsync({ ids, to: progress.to, reason: progress.reason });
		} finally {
			progress.finish();
		}
	}

	return { mutation, progress, run, retryFailed };
}

/**
 * Query keys a referral change event invalidates (F-09): lists and batches, plus that one detail
 * when the doc id is known (every detail otherwise) — never unrelated referral caches.
 */
export function referralKeysForChange(docId?: string): (readonly unknown[])[] {
	return [
		referralKeys.lists(),
		referralKeys.batches(),
		docId ? referralKeys.detail(docId) : referralKeys.details()
	];
}

export function startReferralsLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type, docId) =>
		type === 'referral' ? referralKeysForChange(docId) : []
	);
}
