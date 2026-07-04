import { createQuery } from '@tanstack/svelte-query';
import { SHELTER_CODE } from '$lib/db/shelter';
import { sopMasterRepository, sopOverrideRepository } from '../data/sop-ratio.pouch';
import type { SopMaster, SopOverride } from '../domain/sop-ratio';

export const sopRatioKeys = {
	all: ['sop_ratios'] as const,
	active: () => [...sopRatioKeys.all, 'active'] as const,
	list: () => [...sopRatioKeys.all, 'list'] as const
};

export const sopVersionKeys = {
	all: () => [...sopRatioKeys.all, 'versions'] as const,
	master: () => [...sopVersionKeys.all(), 'master'] as const,
	override: () => [...sopVersionKeys.all(), 'override'] as const
};

function getLatestVersion<T extends { version: number }>(list: T[]): T | null {
	if (list.length === 0) return null;
	return [...list].sort((a, b) => b.version - a.version)[0];
}

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
	const activeOverride = getLatestVersion(overrides);
	const activeMaster = getLatestVersion(masters);
	return activeOverride ?? activeMaster ?? null;
}

export const useActiveSopRatio = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.active(),
		queryFn: getActiveSopProfile
	}));

/**
 * @deprecated Use `useActiveSopRatio` instead.
 * Kept for backward compatibility with the kitchen/meal-plan features.
 */
export const useActiveSopProfile = useActiveSopRatio;

export const useSopProfiles = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.list(),
		queryFn: () => sopMasterRepository().listActive()
	}));
