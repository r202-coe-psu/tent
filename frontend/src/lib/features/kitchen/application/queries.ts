import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import { kitchenRepository, kitchenDb } from '../data/kitchen.pouch';
import type { ProductionLog, ProductionLogInput } from '../domain/kitchen';

export const kitchenKeys = {
	all: ['kitchen'] as const,
	logs: () => [...kitchenKeys.all, 'production_logs'] as const
};

export const useProductionLogs = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.logs(),
		queryFn: () => kitchenRepository().listProductionLogs()
	}));

export const useCreateProductionLog = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ProductionLogInput; ctx: AuthorContext }) =>
			kitchenRepository().createProductionLog(input, ctx)
	}));

export const useUpdateProductionLog = () =>
	createMutation(() => ({
		mutationFn: (log: ProductionLog) => kitchenRepository().updateProductionLog(log)
	}));

export function startKitchenLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(kitchenDb(), queryClient, (type) =>
		type === 'production_log' ? [kitchenKeys.logs()] : []
	);
}
