import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { peopleRepository, shelterDb } from '../data/people.pouch';
import type {
	Evacuee,
	EvacueeInput,
	Household,
	HouseholdInput,
	ScreeningInput,
	Medical,
	Movement,
	Screening
} from '../domain/people';
import { isMedical, isMovement, isScreening } from '../domain/people';

export const peopleKeys = {
	all: ['people'] as const,
	evacuees: () => [...peopleKeys.all, 'evacuees'] as const,
	evacueesPaginated: (page: number, pageSize: number) =>
		[...peopleKeys.all, 'evacuees', { page, pageSize }] as const,
	evacueesSearch: (query: string) => [...peopleKeys.all, 'evacuees', 'search', query] as const,
	households: () => [...peopleKeys.all, 'households'] as const,
	householdsPaginated: (page: number, pageSize: number) =>
		[...peopleKeys.all, 'households', { page, pageSize }] as const,
	medicals: () => [...peopleKeys.all, 'medicals'] as const,
	movements: () => [...peopleKeys.all, 'movements'] as const,
	screenings: () => [...peopleKeys.all, 'screenings'] as const
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

export const useMedicals = () =>
	createQuery(() => ({
		queryKey: peopleKeys.medicals(),
		queryFn: async () => {
			const db = shelterDb();
			const res = await db.allDocs({
				include_docs: true,
				startkey: 'medical:',
				endkey: 'medical:￰'
			});
			return res.rows.map((r) => r.doc as unknown).filter((d): d is Medical => isMedical(d));
		}
	}));

export const useMovements = () =>
	createQuery(() => ({
		queryKey: peopleKeys.movements(),
		queryFn: async () => {
			const db = shelterDb();
			const res = await db.allDocs({
				include_docs: true,
				startkey: 'movement:',
				endkey: 'movement:￰'
			});
			return res.rows.map((r) => r.doc as unknown).filter((d): d is Movement => isMovement(d));
		}
	}));

export const useScreenings = () =>
	createQuery(() => ({
		queryKey: peopleKeys.screenings(),
		queryFn: async () => {
			const db = shelterDb();
			const res = await db.allDocs({
				include_docs: true,
				startkey: 'screening:',
				endkey: 'screening:￰'
			});
			return res.rows.map((r) => r.doc as unknown).filter((d): d is Screening => isScreening(d));
		}
	}));

export function startPeopleLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(shelterDb(), queryClient, (type) => {
		if (type === 'evacuee') {
			return [peopleKeys.evacuees(), [...peopleKeys.all, 'evacuees', 'search']];
		}
		if (type === 'household') {
			return [peopleKeys.households(), [...peopleKeys.all, 'households']];
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
