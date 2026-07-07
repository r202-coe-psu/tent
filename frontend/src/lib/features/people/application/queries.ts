import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { peopleRepository, shelterDb } from '../data/people.pouch';
import type { HouseholdSearchLabels } from '../data/people.repository';
import type {
	Evacuee,
	EvacueeInput,
	Household,
	HouseholdInput,
	ScreeningInput
} from '../domain/people';

export const peopleKeys = {
	all: ['people'] as const,
	evacuees: () => [...peopleKeys.all, 'evacuees'] as const,
	evacueesPaginated: (page: number, pageSize: number, search = '') =>
		[...peopleKeys.all, 'evacuees', { page, pageSize, search }] as const,
	evacueesSearch: (query: string) => [...peopleKeys.all, 'evacuees', 'search', query] as const,
	households: () => [...peopleKeys.all, 'households'] as const,
	householdsPaginated: (page: number, pageSize: number, search = '', labelsKey = '') =>
		[...peopleKeys.all, 'households', { page, pageSize, search, labelsKey }] as const,
	medicals: () => [...peopleKeys.all, 'medicals'] as const,
	movements: () => [...peopleKeys.all, 'movements'] as const,
	screenings: () => [...peopleKeys.all, 'screenings'] as const
};

export const useEvacuees = () =>
	createQuery(() => ({
		queryKey: peopleKeys.evacuees(),
		queryFn: () => peopleRepository().listEvacuees()
	}));

export const useEvacueesPaginated = (
	page: () => number,
	pageSize: () => number,
	search?: () => string
) =>
	createQuery(() => ({
		queryKey: peopleKeys.evacueesPaginated(page(), pageSize(), search?.() ?? ''),
		queryFn: () =>
			peopleRepository().listEvacueesPaginated(page(), pageSize(), search?.()) as Promise<
				PaginatedResult<Evacuee>
			>
	}));

export const useSearchEvacuees = (query: () => string, enabled: () => boolean) =>
	createQuery(() => ({
		queryKey: peopleKeys.evacueesSearch(query()),
		queryFn: () => peopleRepository().searchEvacuees(query()),
		enabled: enabled()
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

export const useCheckInEvacuee = () =>
	createMutation(() => ({
		mutationFn: ({
			evacuee,
			ctx,
			zone
		}: {
			evacuee: Evacuee;
			ctx: AuthorContext;
			zone?: string | null;
		}) => peopleRepository().checkInEvacuee(evacuee, ctx, zone ?? evacuee.current_stay.zone)
	}));

export const useCheckOutEvacuee = () =>
	createMutation(() => ({
		mutationFn: ({ evacuee, ctx }: { evacuee: Evacuee; ctx: AuthorContext }) =>
			peopleRepository().checkOutEvacuee(evacuee, ctx)
	}));

export const useHouseholds = () =>
	createQuery(() => ({
		queryKey: peopleKeys.households(),
		queryFn: () => peopleRepository().listHouseholds()
	}));

export const useHouseholdsPaginated = (
	page: () => number,
	pageSize: () => number,
	search?: () => string,
	labels?: () => HouseholdSearchLabels
) =>
	createQuery(() => ({
		queryKey: peopleKeys.householdsPaginated(
			page(),
			pageSize(),
			search?.() ?? '',
			labels ? JSON.stringify(labels()) : ''
		),
		queryFn: () =>
			peopleRepository().listHouseholdsPaginated(
				page(),
				pageSize(),
				search?.(),
				labels?.()
			) as Promise<PaginatedResult<Household>>
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

export const useMedicals = () =>
	createQuery(() => ({
		queryKey: peopleKeys.medicals(),
		queryFn: () => peopleRepository().listMedicals()
	}));

export const useMovements = () =>
	createQuery(() => ({
		queryKey: peopleKeys.movements(),
		queryFn: () => peopleRepository().listMovements()
	}));

export const useScreenings = () =>
	createQuery(() => ({
		queryKey: peopleKeys.screenings(),
		queryFn: () => peopleRepository().listScreenings()
	}));

export function startPeopleLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(shelterDb(), queryClient, (type) => {
		if (type === 'evacuee') {
			return [[...peopleKeys.all, 'evacuees']];
		}
		if (type === 'household') {
			return [[...peopleKeys.all, 'households']];
		}
		if (type === 'medical') {
			return [peopleKeys.medicals()];
		}
		if (type === 'movement') {
			return [peopleKeys.movements()];
		}
		if (type === 'screening') {
			return [peopleKeys.screenings()];
		}
		return [];
	});
}
