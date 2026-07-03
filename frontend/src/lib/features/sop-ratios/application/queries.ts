import { createQuery } from '@tanstack/svelte-query';
import { getShelterCode } from '$lib/db/shelter';
import { sopMasterRepository, sopOverrideRepository } from '../data/sop-ratio.pouch';
import type { SopMaster, SopOverride } from '../domain/sop-ratio';

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
		sopOverrideRepository(getShelterCode()).listActive(),
		sopMasterRepository().listActive()
	]);
	const activeOverride =
		overrides.length > 0 ? [...overrides].sort((a, b) => b.version - a.version)[0] : null;
	const activeMaster =
		masters.length > 0 ? [...masters].sort((a, b) => b.version - a.version)[0] : null;
	return activeOverride ?? activeMaster ?? null;
}

export const useActiveSopProfile = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.active(),
		queryFn: getActiveSopProfile
	}));

export const useSopProfiles = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.list(),
		queryFn: () => sopMasterRepository().listActive()
	}));
