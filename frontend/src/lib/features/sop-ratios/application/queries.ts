import { createQuery } from '@tanstack/svelte-query';
import { sopRatioRepository } from '../data/sop-ratio.pouch';

export const sopRatioKeys = {
	all: ['sop_ratios'] as const,
	active: () => [...sopRatioKeys.all, 'active'] as const,
	list: () => [...sopRatioKeys.all, 'list'] as const
};

export const useActiveSopProfile = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.active(),
		queryFn: () => sopRatioRepository().getActiveProfile()
	}));

export const useSopProfiles = () =>
	createQuery(() => ({
		queryKey: sopRatioKeys.list(),
		queryFn: () => sopRatioRepository().listProfiles()
	}));
