/**
 * use-version-history.ts — TanStack Query hook for SOP version history (T-30.5)
 *
 * Fetches all historical versions of an SOP profile (master or override) by name,
 * sorted newest-first by `version`. Used to populate the `version-history-drawer`
 * component in T-30.6 UI.
 *
 * Covers both profile types per CR-006 Two-Tier architecture:
 *   - Master history  → listVersions() on SopMasterPouchRepository (catalog DB)
 *   - Override history → listVersions() on SopOverridePouchRepository (shelter_* DB)
 *
 * Source references:
 *   - sop-ratio.repository.ts → SopMasterRepository.listVersions, SopOverrideRepository.listVersions
 *   - sop-ratio.pouch.ts → sopMasterRepository(), sopOverrideRepository()
 *   - sop-ratio.domain.ts → SopMaster, SopOverride types
 *   - queries.ts → sopRatioKeys
 *   - CONVENTIONS.md §8 "Query hooks" + §8 "Query key factory"
 *   - CR-006 §History query: history query ได้ตาม version + ใคร/เมื่อไร/ค่าเดิม/reason
 */

import { createQuery } from '@tanstack/svelte-query';
import { SHELTER_CODE } from '$lib/db/shelter';
import { sopMasterRepository, sopOverrideRepository } from '../data/sop-ratio.pouch';
import type { SopMaster, SopOverride } from '../domain/sop-ratio';
import { sopRatioKeys } from './queries';

// ---------------------------------------------------------------------------
// Query key extension — version history sub-key
// Convention: camelCase + Keys suffix (CONVENTIONS.md §8 "Query key factory")
// ---------------------------------------------------------------------------
export const sopVersionKeys = {
	masterHistory: (name: string) => [...sopRatioKeys.all, 'master', 'history', name] as const,
	overrideHistory: (name: string) =>
		[...sopRatioKeys.all, 'override', 'history', name, SHELTER_CODE] as const
};

// ---------------------------------------------------------------------------
// Fetch functions (thin — business logic stays in repository)
// ---------------------------------------------------------------------------

async function fetchMasterVersions(name: string): Promise<SopMaster[]> {
	const all = await sopMasterRepository().listVersions(name);
	// Sort newest-first by version number for timeline display in UI drawer
	return [...all].sort((a, b) => b.version - a.version);
}

async function fetchOverrideVersions(name: string): Promise<SopOverride[]> {
	const all = await sopOverrideRepository(SHELTER_CODE).listVersions(name);
	return [...all].sort((a, b) => b.version - a.version);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns all historical versions of a **master** SOP profile by name,
 * sorted newest-first.
 *
 * Disabled when `name` is empty/undefined to prevent unnecessary DB reads.
 *
 * Usage in a Svelte component (e.g. version-history-drawer.svelte):
 * ```svelte
 * <script lang="ts">
 *   import { useMasterVersionHistory } from '$lib/features/sop-ratios';
 *
 *   const { profileName }: { profileName: string } = $props();
 *   const query = useMasterVersionHistory(profileName);
 * </script>
 *
 * {#each $query.data ?? [] as version (version._id)}
 *   <li>v{version.version} — {version.updated_at} — by {version.created_by}</li>
 * {/each}
 * ```
 */
export const useMasterVersionHistory = (name: string) =>
	createQuery(() => ({
		queryKey: sopVersionKeys.masterHistory(name),
		queryFn: () => fetchMasterVersions(name),
		enabled: name.trim().length > 0,
		staleTime: 0
	}));

/**
 * Returns all historical versions of the current shelter's **override** SOP profile by name,
 * sorted newest-first.
 *
 * Override history is scoped to `SHELTER_CODE` — the current shelter's DB only.
 * This enforces the shelter-scope isolation rule from CONVENTIONS.md §5
 * (never read another shelter's data).
 */
export const useOverrideVersionHistory = (name: string) =>
	createQuery(() => ({
		queryKey: sopVersionKeys.overrideHistory(name),
		queryFn: () => fetchOverrideVersions(name),
		enabled: name.trim().length > 0,
		staleTime: 0
	}));
