import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb, getShelterCode } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { peopleRepository } from '../data/people.remote';
import type { HouseholdSearchLabels } from '../data/people.repository';
import type {
	Evacuee,
	EvacueeInput,
	Household,
	HouseholdInput,
	ScreeningInput
} from '../domain/people';

// Every key includes the active shelter code so switching the back-office
// shelter selector (shelterStore.selectedShelterCode) invalidates and
// refetches these queries against the newly selected shelter's database.
export const peopleKeys = {
	all: ['people'] as const,
	evacuees: () => [...peopleKeys.all, 'evacuees', getShelterCode()] as const,
	evacuee: (id: string) => [...peopleKeys.all, 'evacuee', getShelterCode(), id] as const,
	evacueesPaginated: (page: number, pageSize: number, search = '') =>
		[...peopleKeys.all, 'evacuees', getShelterCode(), { page, pageSize, search }] as const,
	evacueesSearch: (query: string) =>
		[...peopleKeys.all, 'evacuees', getShelterCode(), 'search', query] as const,
	households: () => [...peopleKeys.all, 'households', getShelterCode()] as const,
	household: (id: string) => [...peopleKeys.all, 'household', getShelterCode(), id] as const,
	householdsPaginated: (page: number, pageSize: number, search = '', labelsKey = '') =>
		[
			...peopleKeys.all,
			'households',
			getShelterCode(),
			{ page, pageSize, search, labelsKey }
		] as const,
	medicals: () => [...peopleKeys.all, 'medicals', getShelterCode()] as const,
	movements: () => [...peopleKeys.all, 'movements', getShelterCode()] as const,
	screenings: () => [...peopleKeys.all, 'screenings', getShelterCode()] as const
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

export const useEvacuee = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: peopleKeys.evacuee(id()),
		queryFn: () => peopleRepository().getEvacuee(id()),
		enabled: enabled() && !!id()
	}));

export const useCreateEvacuee = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: EvacueeInput; ctx: AuthorContext }) =>
			peopleRepository().createEvacuee(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
		}
	}));
};

export const useUpdateEvacuee = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (evacuee: Evacuee) => peopleRepository().updateEvacuee(evacuee),
		onSuccess: (evacuee) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuee(evacuee._id) });
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
		}
	}));
};

export const useCheckInEvacuee = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			evacuee,
			ctx,
			zone
		}: {
			evacuee: Evacuee;
			ctx: AuthorContext;
			zone?: string | null;
		}) => peopleRepository().checkInEvacuee(evacuee, ctx, zone ?? evacuee.current_stay.zone),
		onSuccess: (evacuee) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuee(evacuee._id) });
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.movements() });
		}
	}));
};

export const useCheckOutEvacuee = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ evacuee, ctx }: { evacuee: Evacuee; ctx: AuthorContext }) =>
			peopleRepository().checkOutEvacuee(evacuee, ctx),
		onSuccess: (evacuee) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuee(evacuee._id) });
			queryClient.invalidateQueries({ queryKey: peopleKeys.movements() });
		}
	}));
};

/** One-shot lookup used by the scan flow — goes through TanStack Query keys. */
export async function lookupEvacueeByScanCode(
	queryClient: QueryClient,
	code: string
): Promise<Evacuee | null> {
	const cleanCode = code.trim();
	if (!cleanCode) return null;

	let lookupId = cleanCode;
	if (!lookupId.startsWith('evacuee:')) {
		lookupId = `evacuee:${cleanCode}`;
	}

	try {
		const byId = await queryClient.fetchQuery({
			queryKey: peopleKeys.evacuee(lookupId),
			queryFn: () => peopleRepository().getEvacuee(lookupId)
		});
		if (byId) return byId;
	} catch {
		// Ignore direct ID fetch errors and fall through to search.
	}

	const matches = await queryClient.fetchQuery({
		queryKey: peopleKeys.evacueesSearch(cleanCode),
		queryFn: () => peopleRepository().searchEvacuees(cleanCode)
	});
	return matches[0] ?? null;
}

export const useHouseholds = () =>
	createQuery(() => ({
		queryKey: peopleKeys.households(),
		queryFn: () => peopleRepository().listHouseholds()
	}));

export const useHousehold = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: peopleKeys.household(id()),
		queryFn: () => peopleRepository().getHousehold(id()),
		enabled: enabled() && !!id()
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

export const useCreateHousehold = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: HouseholdInput; ctx: AuthorContext }) =>
			peopleRepository().createHousehold(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
		}
	}));
};

export const useUpdateHousehold = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (household: Household) => peopleRepository().updateHousehold(household),
		onSuccess: (household) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.household(household._id) });
		}
	}));
};

export const useCancelPreRegistration = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ householdId, ctx }: { householdId: string; ctx: AuthorContext }) =>
			peopleRepository().cancelPreRegistration(householdId, ctx),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.household(variables.householdId) });
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
		}
	}));
};

export const useCreateScreening = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ScreeningInput; ctx: AuthorContext }) =>
			peopleRepository().createScreening(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.screenings() });
		}
	}));
};

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

export function startPeopleLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
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
