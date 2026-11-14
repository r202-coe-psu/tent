/**
 * TanStack Query hooks for the central warehouse (M6) (draft CR M6 §2).
 */
import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { getShelterCode } from '$lib/db/shelter';
import {
	cancelWithdrawalRemote,
	createWithdrawalRemote,
	fetchWarehouseStock,
	fetchWarehouses,
	fetchWithdrawals,
	searchCatalog
} from '../data/central-warehouse.remote';
import type { WithdrawalCreateInput } from '../domain/central-warehouse.payload';

/** Warehouses / stock / catalog are cached 60 s in FastAPI; match it so refetches stay cheap. */
const STOCK_STALE_MS = 60_000;
/** M6 changes a request's status on its own; the list re-reads the Mongo snapshot every 30 s. */
const WITHDRAWALS_REFETCH_MS = 30_000;

export const centralWarehouseKeys = {
	all: ['central-warehouse'] as const,
	warehouses: () => [...centralWarehouseKeys.all, 'warehouses'] as const,
	stock: (code: string) => [...centralWarehouseKeys.all, 'stock', code] as const,
	catalog: (q: string, warehouseCode: string, typeCode: string) =>
		[...centralWarehouseKeys.all, 'catalog', q, warehouseCode, typeCode] as const,
	withdrawals: () => [...centralWarehouseKeys.all, 'withdrawals', getShelterCode()] as const
};

export const useWarehouses = (enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: centralWarehouseKeys.warehouses(),
		queryFn: fetchWarehouses,
		staleTime: STOCK_STALE_MS,
		retry: false,
		enabled: enabled()
	}));

/** One warehouse's whole stock; the UI filters it by name and type in the browser. */
export const useWarehouseStock = (code: () => string | null) =>
	createQuery(() => ({
		queryKey: centralWarehouseKeys.stock(code() ?? ''),
		queryFn: () => fetchWarehouseStock(code()!),
		staleTime: STOCK_STALE_MS,
		retry: false,
		enabled: code() !== null
	}));

export const useCatalogSearch = (
	params: () => { q: string; warehouse_code: string; type_code: string },
	enabled: () => boolean = () => true
) =>
	createQuery(() => ({
		queryKey: centralWarehouseKeys.catalog(params().q, params().warehouse_code, params().type_code),
		queryFn: () =>
			searchCatalog({
				q: params().q,
				warehouse_code: params().warehouse_code,
				type_code: params().type_code
			}),
		staleTime: STOCK_STALE_MS,
		retry: false,
		enabled: enabled()
	}));

export const useWithdrawals = () =>
	createQuery(() => ({
		queryKey: centralWarehouseKeys.withdrawals(),
		queryFn: fetchWithdrawals,
		refetchInterval: WITHDRAWALS_REFETCH_MS,
		retry: false
	}));

function invalidateWithdrawals(queryClient: QueryClient) {
	void queryClient.invalidateQueries({ queryKey: centralWarehouseKeys.withdrawals() });
}

export const useCreateWithdrawal = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: WithdrawalCreateInput) => createWithdrawalRemote(input),
		onSuccess: () => invalidateWithdrawals(queryClient)
	}));

export const useCancelWithdrawal = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (v: { requestCode: string; reason: string }) =>
			cancelWithdrawalRemote(v.requestCode, v.reason),
		onSettled: () => invalidateWithdrawals(queryClient)
	}));
