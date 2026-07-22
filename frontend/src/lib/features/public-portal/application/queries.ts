import { createMutation, createQuery } from '@tanstack/svelte-query';
import { familySearch, listPublicShelters } from '../data/public-api';
import type { ListPublicSheltersParams } from '../domain/types';

export const publicPortalKeys = {
	all: ['public-portal'] as const,
	shelters: (params: ListPublicSheltersParams) =>
		[...publicPortalKeys.all, 'shelters', params] as const,
	familySearch: (query: string) => [...publicPortalKeys.all, 'family-search', query] as const
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
