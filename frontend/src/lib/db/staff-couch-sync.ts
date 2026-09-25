import type { QueryClient } from '@tanstack/svelte-query';
import { startCatalogMasterLiveQuery } from '$lib/features/catalog';
import { startKitchenLiveQuery } from '$lib/features/kitchen';
import { startOperationsLiveQuery } from '$lib/features/operations';
import { startPeopleLiveQuery } from '$lib/features/people';
import { startPeopleImportLiveQuery } from '$lib/features/people-import';
import { startReferralsLiveQuery } from '$lib/features/referrals';
import { startDailyCalcLiveQuery } from '$lib/features/resource-calc';
import { SHELTER_REGISTRY_DB, startSheltersLiveQuery } from '$lib/features/shelters';
import { startSopRatioLiveQuery } from '$lib/features/sop-ratios';
import { CATALOG_DB, startCatalogLiveQuery } from '$lib/features/supply';
import { startTicketsLiveQuery } from '$lib/features/tickets';
import { startVolunteersLiveQuery } from '$lib/features/volunteers';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { startChangesSubscriber, type ChangesSubscriberHandle } from './changes-subscriber';
import { getShelterDb } from './shelter';

/** Defer `_changes` so initial page queries can claim HTTP connections first. */
export const CHANGES_FEED_START_DELAY_MS = 1_500;

export interface StaffCouchSyncHandle {
	stop(): void;
}

type Stoppable = { stop(): void };
type LiveQueryStarter = (queryClient: QueryClient) => Stoppable;

/**
 * Feature live-query wiring. Append a new `startXxxLiveQuery` here — do not
 * start CouchDB subscribers from public layouts.
 */
export const STAFF_LIVE_QUERY_STARTERS: readonly LiveQueryStarter[] = [
	startSheltersLiveQuery,
	startCatalogLiveQuery,
	startCatalogMasterLiveQuery,
	startPeopleLiveQuery,
	startPeopleImportLiveQuery,
	startOperationsLiveQuery,
	startKitchenLiveQuery,
	startTicketsLiveQuery,
	startSopRatioLiveQuery,
	startDailyCalcLiveQuery,
	startReferralsLiveQuery,
	startVolunteersLiveQuery
];

export interface StartStaffCouchSyncOptions {
	liveQueryStarters?: readonly LiveQueryStarter[];
	changesStartDelayMs?: number;
}

/**
 * Refetch active TanStack queries after a Couch `_session` cookie is restored.
 *
 * Queries that failed with 401/403 while `needsReauth` was set stay in the
 * error cache; live `_changes` only invalidates on document events, so the
 * protected layout must call this when reauth succeeds (see CR-033 sync restart).
 */
export function invalidateQueriesAfterReauth(queryClient: QueryClient): void {
	void queryClient.invalidateQueries();
}

/**
 * Staff-only CouchDB live connection: probe central, long-poll `_changes`,
 * and invalidate TanStack Query via feature live-query subscribers.
 * Call from `(protected)` layout only — public routes must not import this.
 */
export function startStaffCouchSync(
	queryClient: QueryClient,
	options: StartStaffCouchSyncOptions = {}
): StaffCouchSyncHandle {
	void endpointStore.probe();

	const starters = options.liveQueryStarters ?? STAFF_LIVE_QUERY_STARTERS;
	const live = starters.map((start) => start(queryClient));

	const shelterDb = getShelterDb();
	let subscriber: ChangesSubscriberHandle | null = null;
	const timer = setTimeout(() => {
		subscriber = startChangesSubscriber([SHELTER_REGISTRY_DB, CATALOG_DB, shelterDb]);
	}, options.changesStartDelayMs ?? CHANGES_FEED_START_DELAY_MS);

	return {
		stop() {
			clearTimeout(timer);
			subscriber?.stop();
			for (const handle of live) handle.stop();
		}
	};
}
