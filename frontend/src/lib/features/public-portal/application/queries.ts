import { createMutation, createQuery } from '@tanstack/svelte-query';
import {
	familySearch,
	fetchShelterTypeLabels,
	fetchVulnerableGroupLabels,
	listPublicShelters
} from '../data/public-api';
import { toLabelMap } from '../domain/master-labels';
import type { ListPublicSheltersParams } from '../domain/types';

const LABEL_STALE_MS = 5 * 60 * 1000;

export const publicPortalKeys = {
	all: ['public-portal'] as const,
	shelters: (params: ListPublicSheltersParams) =>
		[...publicPortalKeys.all, 'shelters', params] as const,
	familySearch: (query: string) => [...publicPortalKeys.all, 'occupants', query] as const,
	vulnerableGroupLabels: () => [...publicPortalKeys.all, 'vulnerable-group-labels'] as const,
	shelterTypeLabels: () => [...publicPortalKeys.all, 'shelter-type-labels'] as const
};

export function usePublicShelters(params: () => ListPublicSheltersParams) {
	return createQuery(() => ({
		queryKey: publicPortalKeys.shelters(params()),
		queryFn: () => listPublicShelters(params())
	}));
}

export function useFamilySearchMutation() {
	return createMutation(() => ({
		mutationFn: (query: string) => familySearch(query)
	}));
}

/** Shared across shelter cards / detail — TanStack dedupes by key. */
export function useVulnerableGroupLabelMap() {
	return createQuery(() => ({
		queryKey: publicPortalKeys.vulnerableGroupLabels(),
		queryFn: async () => toLabelMap(await fetchVulnerableGroupLabels()),
		staleTime: LABEL_STALE_MS
	}));
}

export function useShelterTypeLabelMap() {
	return createQuery(() => ({
		queryKey: publicPortalKeys.shelterTypeLabels(),
		queryFn: async () => toLabelMap(await fetchShelterTypeLabels()),
		staleTime: LABEL_STALE_MS
	}));
}
