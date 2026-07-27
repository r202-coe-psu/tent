import { createQuery, createMutation, useQueryClient, type QueryClient } from '@tanstack/svelte-query';
import { supplyRepository, CATALOG_DB } from '../data/supply.remote';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb } from '$lib/db/shelter';
import type { StockThresholdOverride } from '../domain/threshold-override';
import type { AuthorContext } from '$lib/db/model';

export const supplyKeys = {
	all: ['supply'] as const,
	list: () => [...supplyKeys.all, 'list'] as const,
	overrides: () => [...supplyKeys.all, 'overrides'] as const,
	detail: (id: string) => [...supplyKeys.all, 'detail', id] as const
};

export const useSupplyItems = () =>
	createQuery(() => ({
		queryKey: supplyKeys.list(),
		queryFn: () => supplyRepository().listItems()
	}));

export const useSupplyItem = (id: () => string) =>
	createQuery(() => ({
		queryKey: supplyKeys.detail(id()),
		queryFn: () => supplyRepository().getItem(id()),
		enabled: !!id()
	}));

export const useThresholdOverrides = () =>
	createQuery(() => ({
		queryKey: supplyKeys.overrides(),
		queryFn: () => supplyRepository().listThresholdOverrides()
	}));

export const useSaveThresholdOverride = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: Omit<StockThresholdOverride, 'type' | 'schema_v'>; ctx: AuthorContext }) =>
			supplyRepository().saveThresholdOverride(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: supplyKeys.overrides() });
		}
	}));
};

export function startCatalogLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	const catalogHandle = subscribeDataChanges(queryClient, CATALOG_DB, (type) => {
		if (type === 'supply_item') {
			return [supplyKeys.all];
		}
		return [];
	});

	const shelterHandle = subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (type === 'stock_threshold_override') {
			return [supplyKeys.overrides()];
		}
		return [];
	});

	return {
		stop: () => {
			catalogHandle.stop();
			shelterHandle.stop();
		}
	};
}
