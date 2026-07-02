import { createQuery } from '@tanstack/svelte-query';
import { SHELTER_CODE } from '$lib/db/shelter';
import { sopMasterRepository, sopOverrideRepository } from '../data/sop-ratio.pouch';
import type { SopMaster, SopOverride } from '../domain/sop-ratio';
import { useActiveSopRatio } from './use-active-sop-ratio';

export const sopRatioKeys = {
	all: ['sop_ratios'] as const,
	active: () => [...sopRatioKeys.all, 'active'] as const,
	list: () => [...sopRatioKeys.all, 'list'] as const
};

/**
 * Active SOP source for this shelter — the override wins over the catalog
 * master (per resolveEffectiveProfile precedence). Returns the winning doc
 * itself (not just its ratios) so callers can read _id/version for calc_source.
 */
export async function getActiveSopProfile(): Promise<SopMaster | SopOverride | null> {
	const [overrides, masters] = await Promise.all([
		sopOverrideRepository(SHELTER_CODE).listActive(),
		sopMasterRepository().listActive()
	]);
	const activeOverride =
		overrides.length > 0 ? [...overrides].sort((a, b) => b.version - a.version)[0] : null;
	const activeMaster =
		masters.length > 0 ? [...masters].sort((a, b) => b.version - a.version)[0] : null;
	return activeOverride ?? activeMaster ?? null;
}

// Alias for backward compatibility — kitchen feature and other consumers import this name.
// The canonical implementation (with staleTime: 0) lives in use-active-sop-ratio.ts.
export { useActiveSopRatio as useActiveSopProfile };

export const useSopProfiles = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.list(),
		queryFn: () => sopMasterRepository().listActive()
	}));

