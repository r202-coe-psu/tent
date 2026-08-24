import {
	createInfiniteQuery,
	createMutation,
	createQuery,
	useQueryClient
} from '@tanstack/svelte-query';
import type { AuthorContext } from '$lib/db/model';
import { loadCalculationSnapshot } from '$lib/features/resource-calc';
import { scenarioRepository } from '../data/scenario.remote';
import type { ScenarioResult } from '../domain/scenario.schema';

export const scenarioKeys = {
	all: ['sop_simulations'] as const,
	current: (shelterCode: string) => [...scenarioKeys.all, 'current', shelterCode] as const,
	lists: (shelterCode: string) => [...scenarioKeys.all, 'list', shelterCode] as const,
	details: (shelterCode: string) => [...scenarioKeys.all, 'detail', shelterCode] as const,
	detail: (shelterCode: string, id: string) => [...scenarioKeys.details(shelterCode), id] as const
};

export const useCurrentCalculationSnapshot = (shelterCode: () => string) =>
	createQuery(() => ({
		queryKey: scenarioKeys.current(shelterCode()),
		queryFn: () => loadCalculationSnapshot(shelterCode()),
		enabled: shelterCode().length > 0
	}));

export const useScenarios = (shelterCode: () => string) =>
	createInfiniteQuery(() => ({
		queryKey: scenarioKeys.lists(shelterCode()),
		queryFn: ({ pageParam }) => scenarioRepository(shelterCode()).listPage(pageParam),
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: shelterCode().length > 0
	}));

export const useOpenScenario = (shelterCode: () => string) =>
	createMutation(() => ({
		mutationFn: async (id: string) => {
			const scenario = await scenarioRepository(shelterCode()).get(id);
			if (!scenario) throw new Error('Scenario not found');
			return scenario;
		}
	}));

export const useScenario = (shelterCode: () => string, id: () => string) =>
	createQuery(() => ({
		queryKey: scenarioKeys.detail(shelterCode(), id()),
		queryFn: () => scenarioRepository(shelterCode()).get(id()),
		enabled: id().startsWith('simulation:')
	}));

export const useSaveScenario = (shelterCode: () => string) => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ result, ctx }: { result: ScenarioResult; ctx: AuthorContext }) =>
			scenarioRepository(shelterCode()).save(result, ctx),
		onSuccess: (scenario) => {
			queryClient.setQueryData(scenarioKeys.detail(shelterCode(), scenario._id), scenario);
			queryClient.invalidateQueries({ queryKey: scenarioKeys.lists(shelterCode()) });
		}
	}));
};
