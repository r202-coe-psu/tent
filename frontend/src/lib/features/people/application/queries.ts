import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import { peopleRepository, shelterDb } from '../data/people.pouch';
import type { Evacuee, EvacueeInput } from '../domain/people';

export const peopleKeys = {
	all: ['people'] as const,
	evacuees: () => [...peopleKeys.all, 'evacuees'] as const
};

export const useEvacuees = () =>
	createQuery(() => ({
		queryKey: peopleKeys.evacuees(),
		queryFn: () => peopleRepository().listEvacuees()
	}));

// No onSuccess invalidation here — unlike `users`, reactivity is driven by the
// changes feed (startPeopleLiveQuery). A local write lands in PouchDB, the feed
// fires, and the evacuees query invalidates. This is the pattern every feature
// copies (CONTRIBUTING.md §4).
export const useCreateEvacuee = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: EvacueeInput; ctx: AuthorContext }) =>
			peopleRepository().createEvacuee(input, ctx)
	}));

export const useUpdateEvacuee = () =>
	createMutation(() => ({
		mutationFn: (evacuee: Evacuee) => peopleRepository().updateEvacuee(evacuee)
	}));

/**
 * Wire the shelter changes feed to people query invalidation. Started after
 * auth, stopped on logout (see the root layout). Returns a handle to stop it.
 */
export function startPeopleLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(shelterDb(), queryClient, (type) =>
		type === 'evacuee' ? [peopleKeys.evacuees()] : []
	);
}
