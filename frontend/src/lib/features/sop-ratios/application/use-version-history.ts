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
 *   - sop-ratio.remote.ts → sopMasterRepository(), sopOverrideRepository()
 *   - sop-ratio.domain.ts → SopMaster, SopOverride types
 *   - queries.ts → sopRatioKeys
 *   - CONVENTIONS.md §8 "Query hooks" + §8 "Query key factory"
 *   - CR-006 §History query: history query ได้ตาม version + ใคร/เมื่อไร/ค่าเดิม/reason
 */

import { createQuery } from '@tanstack/svelte-query';
import { getShelterCode } from '$lib/db/shelter';
import { sopMasterRepository, sopOverrideRepository } from '../data/sop-ratio.remote';
import type { SopMaster, SopOverride } from '../domain/sop-ratio';
import { sopVersionKeys } from './queries';

export type SopMasterWithReason = SopMaster & { audit_reason: string | null };
export type SopOverrideWithReason = SopOverride & { audit_reason: string | null };

// ---------------------------------------------------------------------------
// Fetch functions (thin — business logic stays in repository)
// ---------------------------------------------------------------------------

async function fetchMasterVersions(name: string): Promise<SopMasterWithReason[]> {
	const repo = sopMasterRepository();
	const all = await repo.listVersions(name);
	const sorted = [...all].sort((a, b) => b.version - a.version);
	if (sorted.length === 0) return [];

	const ids = sorted.map((v) => v._id);
	const audits = await repo.listAuditsByTargetIds(ids);
	const reasonMap = new Map<string, string>();
	for (const a of audits) {
		reasonMap.set(a.target_id, a.reason);
	}

	return sorted.map((v) => ({
		...v,
		audit_reason: reasonMap.get(v._id) ?? null
	}));
}

async function fetchOverrideVersions(
	name: string,
	shelterCode?: string
): Promise<SopOverrideWithReason[]> {
	const code = shelterCode ?? getShelterCode();
	const repo = sopOverrideRepository(code);
	const all = await repo.listVersions(name);
	const sorted = [...all].sort((a, b) => b.version - a.version);
	if (sorted.length === 0) return [];

	const ids = sorted.map((v) => v._id);
	const audits = await repo.listAuditsByTargetIds(ids);
	const reasonMap = new Map<string, string>();
	for (const a of audits) {
		reasonMap.set(a.target_id, a.reason);
	}

	return sorted.map((v) => ({
		...v,
		audit_reason: reasonMap.get(v._id) ?? null
	}));
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
export const useMasterVersionHistory = (name: string | (() => string)) => {
	const getName = typeof name === 'function' ? name : () => name;
	return createQuery(() => {
		const resolvedName = getName();
		return {
			queryKey: [...sopVersionKeys.master(), resolvedName] as const,
			queryFn: () => fetchMasterVersions(resolvedName),
			enabled: resolvedName.trim().length > 0
		};
	});
};

/**
 * Returns all historical versions of the current shelter's **override** SOP profile by name,
 * sorted newest-first.
 *
 * Override history is scoped to `SHELTER_CODE` — the current shelter's DB only.
 * This enforces the shelter-scope isolation rule from CONVENTIONS.md §5
 * (never read another shelter's data).
 *
 * Usage in a Svelte component (e.g. version-history-drawer.svelte):
 * ```svelte
 * <script lang="ts">
 *   import { useOverrideVersionHistory } from '$lib/features/sop-ratios';
 *
 *   const { profileName }: { profileName: string } = $props();
 *   const query = useOverrideVersionHistory(profileName);
 * </script>
 *
 * {#each $query.data ?? [] as version (version._id)}
 *   <li>v{version.version} — {version.updated_at} — by {version.created_by}</li>
 * {/each}
 * ```
 */
export const useOverrideVersionHistory = (
	name: string | (() => string),
	shelterCode?: string | (() => string)
) => {
	const getName = typeof name === 'function' ? name : () => name;
	const getCode =
		typeof shelterCode === 'function' ? shelterCode : () => shelterCode ?? getShelterCode();
	return createQuery(() => {
		const resolvedName = getName();
		const code = getCode();
		return {
			queryKey: [...sopVersionKeys.override(), resolvedName, code] as const,
			queryFn: () => fetchOverrideVersions(resolvedName, code),
			enabled: resolvedName.trim().length > 0 && code.trim().length > 0
		};
	});
};
