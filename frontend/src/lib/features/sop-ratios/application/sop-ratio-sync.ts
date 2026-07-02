/**
 * sop-ratio-sync.ts — Application layer live-sync wiring (T-30.5)
 *
 * Subscribes to PouchDB `changes` feeds for:
 *   - catalog DB         → sop_profile (master) mutations
 *   - shelter_* DB       → sop_override mutations
 *
 * On any change, invalidates the `sop_ratios` query key family so that
 * TanStack Query refetches automatically. This replaces polling
 * (`refetchInterval`) per CONVENTIONS.md §5 "Live sync reactivity".
 *
 * Pattern source:
 *   - CONVENTIONS.md §5 (db.changes + queryClient.invalidateQueries)
 *   - sop-ratio.pouch.ts (sopMasterRepository, sopOverrideRepository, namedLocalDb)
 *   - CR-006 §Two-Tier: master in catalog, override in shelter_*
 */

import { namedLocalDb } from '$lib/db/pouch';
import { SHELTER_CODE } from '$lib/db/shelter';
import type { QueryClient } from '@tanstack/svelte-query';
import { sopRatioKeys } from './queries';

type ChangesHandle = PouchDB.Core.Changes<object>;

/**
 * Starts live PouchDB changes feed subscriptions for both the master (catalog)
 * and the current shelter's override database.
 *
 * @param queryClient - The TanStack Query client to invalidate when data changes.
 * @returns A cleanup function that cancels both feed subscriptions (call on component destroy).
 *
 * Usage inside a Svelte component:
 * ```svelte
 * <script lang="ts">
 *   import { getQueryClient } from '@tanstack/svelte-query';
 *   import { startSopRatioSync } from '$lib/features/sop-ratios';
 *
 *   const queryClient = getQueryClient();
 *   $effect(() => startSopRatioSync(queryClient));
 * </script>
 * ```
 */
export function startSopRatioSync(queryClient: QueryClient): () => void {
	// --- Master: catalog DB ---
	// sop_profile lives in the "catalog" DB (CatalogDoc, no shelter_code).
	// Reference: sop-ratio.pouch.ts → SopMasterPouchRepository constructor
	const catalogDb = namedLocalDb('catalog');
	const masterFeed: ChangesHandle = catalogDb
		.changes({ live: true, since: 'now', include_docs: false, filter: filterSopProfile })
		.on('change', () => {
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
		})
		.on('error', (err) => {
			// Non-fatal: sync errors are expected during offline periods.
			// We log at warn level and let the next reconnect handle the refetch.
			console.warn('[sop-ratio-sync] catalog changes error', err);
		});

	// --- Override: shelter_* DB ---
	// sop_override lives in the shelter's own DB (BaseDoc, has shelter_code).
	// Reference: sop-ratio.pouch.ts → SopOverridePouchRepository constructor
	const shelterDb = namedLocalDb(`shelter_${SHELTER_CODE.toLowerCase()}`);
	const overrideFeed: ChangesHandle = shelterDb
		.changes({ live: true, since: 'now', include_docs: false, filter: filterSopOverride })
		.on('change', () => {
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
		})
		.on('error', (err) => {
			console.warn('[sop-ratio-sync] shelter override changes error', err);
		});

	// Return cleanup function — call inside Svelte $effect or onDestroy
	return () => {
		masterFeed.cancel();
		overrideFeed.cancel();
	};
}

// ---------------------------------------------------------------------------
// Private filter helpers
// PouchDB filter functions run inside PouchDB, not on the server.
// They receive a raw doc object and must be synchronous.
// ---------------------------------------------------------------------------

function filterSopProfile(doc: { type?: unknown }): boolean {
	return doc.type === 'sop_profile';
}

function filterSopOverride(doc: { type?: unknown }): boolean {
	return doc.type === 'sop_override';
}
