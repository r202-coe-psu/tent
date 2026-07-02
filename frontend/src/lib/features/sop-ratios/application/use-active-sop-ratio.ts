/**
 * use-active-sop-ratio.ts — TanStack Query hook for effective SOP ratio (T-30.5)
 *
 * Provides the currently active ratio set for the current shelter:
 *   - If the shelter has an active override → use that (override wins)
 *   - Otherwise → fall back to the active master profile in catalog
 *
 * Logic implements CR-006 §Effective ratio: `active sop_override ?? active sop_profile (master)`
 * via the existing `getActiveSopProfile` query function in queries.ts.
 *
 * Returns the winning document (SopMaster | SopOverride) directly, not just its ratios,
 * so callers can read `_id`, `version`, and `type` for downstream use in T-31 calc snapshots.
 *
 * Source references:
 *   - queries.ts → sopRatioKeys, getActiveSopProfile
 *   - sop-ratio.pouch.ts → sopMasterRepository, sopOverrideRepository
 *   - CONVENTIONS.md §8 "Query hooks"
 *   - CR-006 §Effective ratio precedence
 */

import { createQuery } from '@tanstack/svelte-query';
import { sopRatioKeys, getActiveSopProfile } from './queries';

/**
 * Returns a TanStack Query for the effective (winning) SOP profile for this shelter.
 *
 * `data` will be:
 *   - `SopOverride`  — when the shelter has an active override (`type === 'sop_override'`)
 *   - `SopMaster`    — when falling back to the catalog master (`type === 'sop_profile'`)
 *   - `null`         — when no active profile exists at all (should not happen post-seed)
 *
 * Usage in a Svelte component:
 * ```svelte
 * <script lang="ts">
 *   import { useActiveSopRatio } from '$lib/features/sop-ratios';
 *
 *   const query = useActiveSopRatio();
 * </script>
 *
 * {#if $query.isLoading}
 *   <Skeleton />
 * {:else if $query.isError}
 *   <p class="text-destructive">ไม่สามารถโหลดข้อมูล SOP ได้</p>
 * {:else if $query.data}
 *   <p>Ratio source: {$query.data.type === 'sop_override' ? 'Override' : 'Master'}</p>
 * {/if}
 * ```
 */
export const useActiveSopRatio = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.active(),
		// Thin queryFn: delegates entirely to the shared data-fetcher in queries.ts
		// Business logic (override-wins precedence) is encapsulated there.
		queryFn: getActiveSopProfile,
		// staleTime: 0 (default) — rely on changes-feed invalidation from sop-ratio-sync.ts,
		// NOT on a timer. CONVENTIONS.md §8: "Never use refetchInterval for live data."
		staleTime: 0
	}));
