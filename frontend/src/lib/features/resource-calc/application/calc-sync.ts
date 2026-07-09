/**
 * T-31.5 — live-sync wiring for the daily resource-calc feature.
 *
 * Invalidates the daily-calc query keys when:
 *   - a `daily_calc` snapshot is written (shelter DB), or
 *   - the active SOP ratio changes — `sop_profile` (catalog) / `sop_override`
 *     (shelter) — since a changed ratio makes the last computed snapshot stale.
 *
 * Uses the app-level changes feed (CR-033 decision B), never `refetchInterval`.
 * Call once per layout, passing the QueryClient; mirrors `startSopRatioLiveQuery`.
 */
import type { QueryClient } from '@tanstack/svelte-query';
import { getShelterDb } from '$lib/db/shelter';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { calcKeys } from './queries';

export function startDailyCalcLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	const catalogHandle = subscribeDataChanges(queryClient, 'catalog', (type) =>
		type === 'sop_profile' ? [calcKeys.all] : []
	);

	const shelterHandle = subscribeDataChanges(queryClient, getShelterDb, (type) =>
		type === 'daily_calc' || type === 'sop_override' ? [calcKeys.all] : []
	);

	return {
		stop: () => {
			catalogHandle.stop();
			shelterHandle.stop();
		}
	};
}
