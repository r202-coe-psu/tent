import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { peopleRepository, shelterDb } from '../data/people.pouch';
import type { Evacuee, EvacueeInput, Household, HouseholdInput, ScreeningInput } from '../domain/people';

export const peopleKeys = {
	all: ['people'] as const,
	evacuees: () => [...peopleKeys.all, 'evacuees'] as const,
	evacueesPaginated: (page: number, pageSize: number) =>
		[...peopleKeys.all, 'evacuees', { page, pageSize }] as const,
	households: () => [...peopleKeys.all, 'households'] as const,
	householdsPaginated: (page: number, pageSize: number) =>
		[...peopleKeys.all, 'households', { page, pageSize }] as const
};

export const useEvacuees = () =>
	createQuery(() => ({
		queryKey: peopleKeys.evacuees(),
		queryFn: () => peopleRepository().listEvacuees()
	}));

export const useEvacueesPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: peopleKeys.evacueesPaginated(page(), pageSize()),
		queryFn: () =>
			peopleRepository().listEvacueesPaginated(page(), pageSize()) as Promise<
				PaginatedResult<Evacuee>
			>
	}));

export const useCreateEvacuee = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: EvacueeInput; ctx: AuthorContext }) =>
			peopleRepository().createEvacuee(input, ctx)
	}));

export const useUpdateEvacuee = () =>
	createMutation(() => ({
		mutationFn: (evacuee: Evacuee) => peopleRepository().updateEvacuee(evacuee)
	}));

export const useHouseholds = () =>
	createQuery(() => ({
		queryKey: peopleKeys.households(),
		queryFn: () => peopleRepository().listHouseholds()
	}));

export const useHouseholdsPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: peopleKeys.householdsPaginated(page(), pageSize()),
		queryFn: () =>
			peopleRepository().listHouseholdsPaginated(page(), pageSize()) as Promise<
				PaginatedResult<Household>
			>
	}));

export const useCreateHousehold = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: HouseholdInput; ctx: AuthorContext }) =>
			peopleRepository().createHousehold(input, ctx)
	}));

export const useUpdateHousehold = () =>
	createMutation(() => ({
		mutationFn: (household: Household) => peopleRepository().updateHousehold(household)
	}));

export const useCreateScreening = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ScreeningInput; ctx: AuthorContext }) =>
			peopleRepository().createScreening(input, ctx)
	}));

export function startPeopleLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(shelterDb(), queryClient, (type) => {
		if (type === 'evacuee') {
			return [peopleKeys.evacuees(), [...peopleKeys.all, 'evacuees']];
		}
		if (type === 'household') {
			return [peopleKeys.households(), [...peopleKeys.all, 'households']];
		}
		return [];
	});
}
