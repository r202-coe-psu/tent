import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { peopleRepository, shelterDb } from '../data/people.pouch';
import type { Evacuee, EvacueeInput } from '../domain/people';

export const peopleKeys = {
	all: ['people'] as const,
	evacuees: () => [...peopleKeys.all, 'evacuees'] as const,
	evacueesPaginated: (page: number, pageSize: number) =>
		[...peopleKeys.all, 'evacuees', { page, pageSize }] as const
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

export function startPeopleLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(shelterDb(), queryClient, (type) =>
		type === 'evacuee' ? [peopleKeys.evacuees(), [...peopleKeys.all, 'evacuees']] : []
	);
}
