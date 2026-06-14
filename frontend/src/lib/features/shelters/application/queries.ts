import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { createShelter, listShelters } from '../data/shelters.api';
import type { CreateShelterInput } from '../domain/schema';

export const sheltersKeys = {
	all: ['shelters'] as const,
	list: () => [...sheltersKeys.all, 'list'] as const
};

export const useShelters = () =>
	createQuery(() => ({
		queryKey: sheltersKeys.list(),
		queryFn: listShelters
	}));

export const useCreateShelter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: CreateShelterInput) => createShelter(input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: sheltersKeys.all })
	}));
};
