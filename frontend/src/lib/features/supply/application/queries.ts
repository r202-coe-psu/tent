import { createQuery, type QueryClient } from '@tanstack/svelte-query';
import { supplyRepository, CATALOG_DB } from '../data/supply.remote';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';

export const supplyKeys = {
	all: ['supply'] as const,
	list: () => [...supplyKeys.all, 'list'] as const,
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

export function startCatalogLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, CATALOG_DB, (type) => {
		if (type === 'supply_item') {
			return [supplyKeys.all];
		}
		return [];
	});
}
