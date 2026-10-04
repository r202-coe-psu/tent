import { createMutation, createQuery } from '@tanstack/svelte-query';
import {
	familySearch,
	fetchShelterTypeLabels,
	fetchVulnerableGroupLabels,
	listPublicShelters
} from '../data/public-api';
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

/** Bilingual vulnerable-group options — derive maps with `toLabelMap(data, langState.current)`. */
export function useVulnerableGroupLabels() {
	return createQuery(() => ({
		queryKey: publicPortalKeys.vulnerableGroupLabels(),
		queryFn: () => fetchVulnerableGroupLabels(),
		staleTime: LABEL_STALE_MS
	}));
}

/** Bilingual shelter-type options — derive maps with `toLabelMap(data, langState.current)`. */
export function useShelterTypeLabels() {
	return createQuery(() => ({
		queryKey: publicPortalKeys.shelterTypeLabels(),
		queryFn: () => fetchShelterTypeLabels(),
		staleTime: LABEL_STALE_MS
	}));
}

/** @deprecated Use `useVulnerableGroupLabels` + `toLabelMap(data, lang)`. */
export const useVulnerableGroupLabelMap = useVulnerableGroupLabels;

/** @deprecated Use `useShelterTypeLabels` + `toLabelMap(data, lang)`. */
export const useShelterTypeLabelMap = useShelterTypeLabels;
