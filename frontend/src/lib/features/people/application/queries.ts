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
import type {
	EvacueeFilters,
	EvacueePatch,
	HouseholdFilters,
	HouseholdPatch,
	HouseholdSearchLabels,
	MedicalPatch
} from '../data/people.repository';
import type {
	Evacuee,
	EvacueeInput,
	Household,
	HouseholdInput,
	Medical,
	MedicalInput,
	ScreeningInput
} from '../domain/people';
import { canCancelHold } from '$lib/auth/roles';
import { authStore } from '$lib/stores/auth.svelte';

// Every key includes the active shelter code so switching the back-office
// shelter selector (shelterStore.selectedShelterCode) invalidates and
// refetches these queries against the newly selected shelter's database.
export const peopleKeys = {
	all: ['people'] as const,
	evacuees: () => [...peopleKeys.all, 'evacuees', getShelterCode()] as const,
	evacuee: (id: string) => [...peopleKeys.all, 'evacuee', getShelterCode(), id] as const,
	evacueesPaginated: (page: number, pageSize: number, search = '', filtersKey = '') =>
		[
			...peopleKeys.all,
			'evacuees',
			getShelterCode(),
			{ page, pageSize, search, filtersKey }
		] as const,
	evacueesSearch: (query: string) =>
		[...peopleKeys.all, 'evacuees', getShelterCode(), 'search', query] as const,
	households: () => [...peopleKeys.all, 'households', getShelterCode()] as const,
	household: (id: string) => [...peopleKeys.all, 'household', getShelterCode(), id] as const,
	householdsPaginated: (
		page: number,
		pageSize: number,
		search = '',
		labelsKey = '',
		filtersKey = ''
	) =>
		[
			...peopleKeys.all,
			'households',
			getShelterCode(),
			{ page, pageSize, search, labelsKey, filtersKey }
		] as const,
	medicals: () => [...peopleKeys.all, 'medicals', getShelterCode()] as const,
	movements: () => [...peopleKeys.all, 'movements', getShelterCode()] as const,
	screenings: () => [...peopleKeys.all, 'screenings', getShelterCode()] as const,
	pendingScreening: (shelterCode = getShelterCode()) =>
		[...peopleKeys.all, 'pending-screening', shelterCode] as const
};

export const usePendingScreeningEvacuees = (shelterCode?: () => string) =>
	createQuery(() => {
		const code = shelterCode ? shelterCode() : getShelterCode();
		return {
			queryKey: peopleKeys.pendingScreening(code),
			queryFn: () => peopleRepository(code).getPendingScreeningEvacuees(code)
		};
	});

export const useEvacuees = () =>
	createQuery(() => ({
		queryKey: peopleKeys.evacuees(),
		queryFn: () => peopleRepository().listEvacuees()
	}));

export const useEvacueesPaginated = (
	page: () => number,
	pageSize: () => number,
	search?: () => string,
	filters?: () => EvacueeFilters
) =>
	createQuery(() => ({
		queryKey: peopleKeys.evacueesPaginated(
			page(),
			pageSize(),
			search?.() ?? '',
			filters ? JSON.stringify(filters()) : ''
		),
		queryFn: () =>
			peopleRepository().listEvacueesPaginated(
				page(),
				pageSize(),
				search?.(),
				filters?.()
			) as Promise<PaginatedResult<Evacuee>>
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

export const useCreateEvacueeWithScreening = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			input,
			screening,
			ctx
		}: {
			input: EvacueeInput;
			screening: Omit<ScreeningInput, 'evacuee_id'> & { evacuee_id?: string };
			ctx: AuthorContext;
		}) => peopleRepository().createEvacueeWithScreening(input, screening, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.screenings() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.medicals() });
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

export const usePatchEvacuee = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, patch }: { id: string; patch: EvacueePatch }) =>
			peopleRepository().patchEvacuee(id, patch),
		onSuccess: (evacuee) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuee(evacuee._id) });
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
		}
	}));
};

export const useCheckInEvacuee = () => {
	const qc = useQueryClient();
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
		onSuccess: (updated) => {
			qc.invalidateQueries({ queryKey: [...peopleKeys.all, 'evacuees'] });
			qc.invalidateQueries({ queryKey: peopleKeys.evacuee(updated._id) });
			qc.invalidateQueries({ queryKey: peopleKeys.households() });
			qc.invalidateQueries({ queryKey: peopleKeys.movements() });
		}
	}));
};

export const useCheckOutEvacuee = () => {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ evacuee, ctx }: { evacuee: Evacuee; ctx: AuthorContext }) =>
			peopleRepository().checkOutEvacuee(evacuee, ctx),
		onSuccess: (updated) => {
			qc.invalidateQueries({ queryKey: [...peopleKeys.all, 'evacuees'] });
			qc.invalidateQueries({ queryKey: peopleKeys.evacuee(updated._id) });
			qc.invalidateQueries({ queryKey: peopleKeys.movements() });
		}
	}));
};

export const useChangeEvacueeZone = () => {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ evacuee, ctx, zone }: { evacuee: Evacuee; ctx: AuthorContext; zone: string }) =>
			peopleRepository().changeEvacueeZone(evacuee, ctx, zone),
		onSuccess: (updated) => {
			qc.invalidateQueries({ queryKey: [...peopleKeys.all, 'evacuees'] });
			qc.invalidateQueries({ queryKey: peopleKeys.evacuee(updated._id) });
			qc.invalidateQueries({ queryKey: peopleKeys.movements() });
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
	labels?: () => HouseholdSearchLabels,
	filters?: () => HouseholdFilters
) =>
	createQuery(() => ({
		queryKey: peopleKeys.householdsPaginated(
			page(),
			pageSize(),
			search?.() ?? '',
			labels ? JSON.stringify(labels()) : '',
			filters ? JSON.stringify(filters()) : ''
		),
		queryFn: () =>
			peopleRepository().listHouseholdsPaginated(
				page(),
				pageSize(),
				search?.(),
				labels?.(),
				filters?.()
			) as Promise<PaginatedResult<Household>>
	}));

export const listMatchingEvacueeIds = (search?: string, filters?: EvacueeFilters) =>
	peopleRepository().listMatchingEvacueeIds(search, filters);

export const listMatchingHouseholdIds = (
	search?: string,
	labels?: HouseholdSearchLabels,
	filters?: HouseholdFilters
) => peopleRepository().listMatchingHouseholdIds(search, labels, filters);

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

export const usePatchHousehold = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, patch }: { id: string; patch: HouseholdPatch }) =>
			peopleRepository().patchHousehold(id, patch),
		onSuccess: (household) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.household(household._id) });
		}
	}));
};

export const useCancelPreRegistration = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ householdId, ctx }: { householdId: string; ctx: AuthorContext }) => {
			if (!canCancelHold(authStore.user?.roles ?? [])) {
				throw new Error('ไม่มีสิทธิ์ยกเลิกการลงทะเบียนล่วงหน้า');
			}
			return peopleRepository().cancelPreRegistration(householdId, ctx);
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.household(variables.householdId) });
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
		}
	}));
};

export const useCancelEvacueePreRegistration = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ evacueeId, ctx }: { evacueeId: string; ctx: AuthorContext }) => {
			if (!canCancelHold(authStore.user?.roles ?? [])) {
				throw new Error('ไม่มีสิทธิ์ยกเลิกการลงทะเบียนล่วงหน้า');
			}
			return peopleRepository().cancelEvacueePreRegistration(evacueeId, ctx);
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuee(variables.evacueeId) });
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
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
			queryClient.invalidateQueries({ queryKey: [...peopleKeys.all, 'pending-screening'] });
		}
	}));
};

export const useRecordMedicalScreening = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			input,
			ctx
		}: {
			input: {
				screening: ScreeningInput;
				zone?: string | null;
				checkIn?: boolean;
				medical?: MedicalInput;
			};
			ctx: AuthorContext;
		}) => peopleRepository().recordMedicalScreening(input, ctx),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: [...peopleKeys.all, 'pending-screening'] });
			queryClient.invalidateQueries({ queryKey: ['pendingScreening'] });
			queryClient.invalidateQueries({ queryKey: [...peopleKeys.all, 'evacuees'] });
			queryClient.invalidateQueries({ queryKey: ['evacuees'] });
			queryClient.invalidateQueries({
				queryKey: peopleKeys.evacuee(variables.input.screening.evacuee_id)
			});
			queryClient.invalidateQueries({ queryKey: ['dashboard', 'occupancy'] });
			queryClient.invalidateQueries({ queryKey: ['shelterOccupancy'] });
			queryClient.invalidateQueries({ queryKey: [...peopleKeys.all, 'screenings'] });
			queryClient.invalidateQueries({ queryKey: ['latest_screening'] });
			queryClient.invalidateQueries({ queryKey: peopleKeys.movements() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.medicals() });
		}
	}));
};

export const useCreateMedical = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: MedicalInput; ctx: AuthorContext }) =>
			peopleRepository().createMedical(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.medicals() });
		}
	}));
};

export const useUpdateMedical = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (medical: Medical) => peopleRepository().updateMedical(medical),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.medicals() });
		}
	}));
};

export const usePatchMedical = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, patch }: { id: string; patch: MedicalPatch }) =>
			peopleRepository().patchMedical(id, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.medicals() });
		}
	}));
};

export const useDeleteMedical = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (id: string) => peopleRepository().deleteMedical(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.medicals() });
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
			return [
				[...peopleKeys.all, 'evacuees'],
				[...peopleKeys.all, 'pending-screening']
			];
		}
		if (type === 'household') {
			return [[...peopleKeys.all, 'households']];
		}
		if (type === 'medical') {
			return [peopleKeys.medicals()];
		}
		if (type === 'movement') {
			return [peopleKeys.movements(), [...peopleKeys.all, 'pending-screening']];
		}
		if (type === 'screening') {
			return [peopleKeys.screenings(), [...peopleKeys.all, 'pending-screening']];
		}
		return [];
	});
}
