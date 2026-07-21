import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { getShelterCode } from '$lib/db/shelter';
import {
	deleteItem,
	getMaster,
	listMasters,
	putMaster,
	type MasterDataSummary
} from '../data/master-data.api';
import type { MasterDataItem, MasterDataQueryContext, MasterDataType } from '../domain/master-data';

type ContextGetter = () => MasterDataQueryContext | undefined;

function defaultContext(): MasterDataQueryContext {
	return { scope: 'effective', shelterCode: getShelterCode() };
}

function contextKey(context: MasterDataQueryContext | undefined): readonly unknown[] {
	const resolved = context ?? defaultContext();
	return [resolved.scope ?? 'effective', resolved.shelterCode ?? null];
}

function queryEnabled(context: MasterDataQueryContext | undefined): boolean {
	return context?.scope === 'global' || !!context?.shelterCode;
}

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
	list: (context?: MasterDataQueryContext) =>
		[...masterDataKeys.all, 'list', ...contextKey(context)] as const,
	detail: (type: MasterDataType, context?: MasterDataQueryContext) =>
		[...masterDataKeys.all, type, ...contextKey(context)] as const
};

export function useMasterDataList(contextGetter: ContextGetter = defaultContext) {
	return createQuery(() => ({
		queryKey: masterDataKeys.list(contextGetter()),
		queryFn: () => listMasters(contextGetter()),
		enabled: queryEnabled(contextGetter())
	}));
}

export function useMasterData(
	type: () => MasterDataType,
	contextGetter: ContextGetter = defaultContext
) {
	return createQuery(() => ({
		queryKey: masterDataKeys.detail(type(), contextGetter()),
		queryFn: () => getMaster(type(), contextGetter()),
		enabled: queryEnabled(contextGetter())
	}));
}

/** Replace the whole items array for a type (UI sends the canonical list). */
export function usePutMaster() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			type,
			items,
			context
		}: {
			type: MasterDataType;
			items: readonly MasterDataItem[];
			context?: MasterDataQueryContext;
		}) => putMaster(type, items, context),
		onSuccess: (_data, { type, context }) => {
			qc.invalidateQueries({ queryKey: masterDataKeys.detail(type, context) });
			qc.invalidateQueries({ queryKey: masterDataKeys.list(context) });
			// A shelter-local write changes both the local key and its effective fallback key.
			qc.invalidateQueries({ queryKey: masterDataKeys.all });
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
		mutationFn: async ({
			type,
			code,
			context
		}: {
			type: MasterDataType;
			code: string;
			context?: MasterDataQueryContext;
		}) => deleteItem(type, code, context),
		onSuccess: (_data, { type, context }) => {
			qc.invalidateQueries({ queryKey: masterDataKeys.detail(type, context) });
			qc.invalidateQueries({ queryKey: masterDataKeys.list(context) });
			qc.invalidateQueries({ queryKey: masterDataKeys.all });
			toast.success('ลบสำเร็จ');
		},
		onError: (e: unknown) => {
			toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
		}
	}));
}

export type { MasterDataSummary };
