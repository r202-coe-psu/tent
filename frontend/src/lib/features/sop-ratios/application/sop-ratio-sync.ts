/**
 * sop-ratio-sync.ts — Application layer live-sync wiring (T-30.5)
 *
 * Subscribes to PouchDB changes feeds via startLiveQuery for:
 *   - catalog DB   → sop_profile (master) mutations
 *   - shelter_* DB → sop_override mutations
 *
 * On any change, invalidates the `sop_ratios` query key family so that
 * TanStack Query refetches automatically.
 */

import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import { namedLocalDb } from '$lib/db/pouch';
import { shelterDb } from '$lib/db/shelter';
import type { QueryClient } from '@tanstack/svelte-query';
import { sopRatioKeys } from './queries';

/**
 * Starts live PouchDB changes feed subscriptions for both the master (catalog)
 * and the current shelter's override database.
 *
 * @param queryClient - The TanStack Query client to invalidate when data changes.
 * @returns A LiveQueryHandle containing a stop() method to cancel subscriptions.
 *
 * Usage inside a Svelte component:
 * ```svelte
 * <script lang="ts">
 *   import { getQueryClient } from '@tanstack/svelte-query';
 *   import { startSopRatioLiveQuery } from '$lib/features/sop-ratios';
 *
 *   const queryClient = getQueryClient();
 *   $effect(() => {
 *     const handle = startSopRatioLiveQuery(queryClient);
 *     return () => handle.stop();
 *   });
 * </script>
 * ```
 */
export function startSopRatioLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	const catalogHandle = startLiveQuery(namedLocalDb('catalog'), queryClient, (type) => {
		return type === 'sop_profile' ? [sopRatioKeys.all] : [];
	});

	const shelterHandle = startLiveQuery(shelterDb(), queryClient, (type) => {
		return type === 'sop_override' ? [sopRatioKeys.all] : [];
	});

	return {
		stop() {
			catalogHandle.stop();
			shelterHandle.stop();
		}
	};
}
