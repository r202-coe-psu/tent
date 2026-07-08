import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import {
	deleteItem,
	getMaster,
	listMasters,
	putMaster,
	type MasterDataSummary
} from '../data/master-data.api';
import type { MasterDataItem, MasterDataType } from '../domain/master-data';

/**
 * Master Data Engine — TanStack Query wiring.
 *
 * The data lives in CouchDB `registry`, accessed through the dev admin BFF
 * (`/api/back-office/master-data/*`). SA-only writes; reads are open to any
 * authenticated user. Mutations toast on success/error and invalidate the
 * `masterData` query key so the UI stays in sync.
 *
 * Phase 1: no PouchDB sync — every read goes through the BFF. Phase 2 will
 * add a live-query layer for the device side (see CR-010).
 */

export const masterDataKeys = {
	all: ['master-data'] as const,
	list: () => [...masterDataKeys.all, 'list'] as const,
	detail: (type: MasterDataType) => [...masterDataKeys.all, type] as const
};

export function useMasterDataList() {
	return createQuery(() => ({
		queryKey: masterDataKeys.list(),
		queryFn: () => listMasters()
	}));
}

export function useMasterData(type: () => MasterDataType) {
	return createQuery(() => ({
		queryKey: masterDataKeys.detail(type()),
		queryFn: () => getMaster(type())
	}));
}

/** Replace the whole items array for a type (UI sends the canonical list). */
export function usePutMaster() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			type,
			items
		}: {
			type: MasterDataType;
			items: readonly MasterDataItem[];
		}) => putMaster(type, items),
		onSuccess: (_data, { type }) => {
			qc.invalidateQueries({ queryKey: masterDataKeys.detail(type) });
			qc.invalidateQueries({ queryKey: masterDataKeys.list() });
			toast.success('บันทึกสำเร็จ');
		},
		onError: (e: unknown) => {
			toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
		}
	}));
}

export function useDeleteMasterItem() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ type, code }: { type: MasterDataType; code: string }) =>
			deleteItem(type, code),
		onSuccess: (_data, { type }) => {
			qc.invalidateQueries({ queryKey: masterDataKeys.detail(type) });
			qc.invalidateQueries({ queryKey: masterDataKeys.list() });
			toast.success('ลบสำเร็จ');
		},
		onError: (e: unknown) => {
			toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
		}
	}));
}

export type { MasterDataSummary };
