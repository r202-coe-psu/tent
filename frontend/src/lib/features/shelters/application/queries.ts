import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { createShelter, listShelters, updateShelter, getShelter } from '../data/shelters.api';
import type { CreateShelterInput, UpdateShelterInput } from '../domain/schema';

export const sheltersKeys = {
	all: ['shelters'] as const,
	list: () => [...sheltersKeys.all, 'list'] as const,
	detail: (code: string) => [...sheltersKeys.all, 'detail', code] as const
};

export const useShelters = () =>
	createQuery(() => ({
		queryKey: sheltersKeys.list(),
		queryFn: listShelters
	}));

export const useShelter = (code: () => string) =>
	createQuery(() => ({
		queryKey: sheltersKeys.detail(code()),
		queryFn: () => getShelter(code()),
		enabled: !!code()
	}));

export const useCreateShelter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: CreateShelterInput) => createShelter(input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: sheltersKeys.all })
	}));
};

export const useUpdateShelter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ code, input }: { code: string; input: UpdateShelterInput }) =>
			updateShelter(code, input),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
		}
	}));
};
