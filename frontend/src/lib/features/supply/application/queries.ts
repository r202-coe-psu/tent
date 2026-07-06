import { createQuery, type QueryClient } from '@tanstack/svelte-query';
import { supplyRepository, CATALOG_DB } from '../data/supply.pouch';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import { namedLocalDb } from '$lib/db/pouch';

/**
 * TanStack Query keys and hooks for the supply catalog.
 *
 * These are read-only queries — the catalog is centrally managed and synced
 * down to devices. No mutations are exposed here.
 */
export const supplyKeys = {
	all: ['supply'] as const,
	list: () => [...supplyKeys.all, 'list'] as const,
	detail: (id: string) => [...supplyKeys.all, 'detail', id] as const
};

/** List all supply items in the catalog. */
export const useSupplyItems = () =>
	createQuery(() => ({
		queryKey: supplyKeys.list(),
		queryFn: () => supplyRepository().listItems()
	}));

/** Fetch a single supply item by id. Used in receive form to read unit + perishable flag. */
export const useSupplyItem = (id: () => string) =>
	createQuery(() => ({
		queryKey: supplyKeys.detail(id()),
		queryFn: () => supplyRepository().getItem(id()),
		enabled: !!id()
	}));

/**
 * Starts a live query changes feed for the supply catalog.
 * Automatically invalidates active queries when database changes happen.
 */
export function startCatalogLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(namedLocalDb(CATALOG_DB), queryClient, (type) => {
		if (type === 'supply_item') {
			return [supplyKeys.all];
		}
		return [];
	});
}
