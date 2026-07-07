import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import { namedLocalDb } from '$lib/db/pouch';
import { createShelter, updateShelter, closeZone, reopenZone } from '../data/shelters.api';
import { sheltersRepository, SHELTER_REGISTRY_DB } from '../data/shelters.pouch';
import type { Shelter } from '../domain/schema';

export const sheltersKeys = {
	all: ['shelters'] as const,
	list: () => [...sheltersKeys.all, 'list'] as const,
	detail: (code: string) => [...sheltersKeys.all, 'detail', code] as const
};

export const useShelters = () =>
	createQuery(() => ({
		queryKey: sheltersKeys.list(),
		queryFn: () => sheltersRepository().listShelters()
	}));

export const useShelter = (code: () => string) =>
	createQuery(() => ({
		queryKey: sheltersKeys.detail(code()),
		queryFn: () => sheltersRepository().getShelter(code()),
		enabled: !!code()
	}));

export const useCreateShelter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: Shelter) => createShelter(input),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			if (result?.code) {
				queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(result.code) });
			}
			toast.success(`บันทึกข้อมูลและสร้างศูนย์พักพิง ${result?.code ?? ''} สำเร็จ`);
		},
		onError: (err: Error) => {
			toast.error(err.message || 'เกิดข้อผิดพลาดในการสร้างศูนย์พักพิง');
		}
	}));
};

export const useUpdateShelter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ code, input }: { code: string; input: Partial<Shelter> }) =>
			updateShelter(code, input),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
			toast.success(`อัปเดตข้อมูลศูนย์พักพิง ${variables.code} สำเร็จ`);
		},
		onError: (err: Error) => {
			toast.error(err.message || 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
		}
	}));
};

export const useCloseZone = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			code,
			zoneCode,
			reason,
			closedBy
		}: {
			code: string;
			zoneCode: string;
			reason?: string;
			closedBy?: string;
		}) => closeZone(code, zoneCode, reason, closedBy),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			toast.success(`ปิดโซน ${variables.zoneCode} ของศูนย์ ${variables.code} เรียบร้อย`);
		},
		onError: (err: Error) => {
			toast.error(err.message || 'ไม่สามารถปิดโซนได้');
		}
	}));
};

export const useReopenZone = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			code,
			zoneCode,
			reopenedBy
		}: {
			code: string;
			zoneCode: string;
			reopenedBy?: string;
		}) => reopenZone(code, zoneCode, reopenedBy),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			toast.success(`เปิดโซน ${variables.zoneCode} ของศูนย์ ${variables.code} อีกครั้ง`);
		},
		onError: (err: Error) => {
			toast.error(err.message || 'ไม่สามารถเปิดโซนได้');
		}
	}));
};

/**
 * Wire the PouchDB changes feed to TanStack Query invalidations for the
 * shelter registry. Reactivity comes from replication (and local writes),
 * not from polling — covers cross-tab writes and remote-sync refreshes.
 *
 * Hook from the root layout alongside the people live query.
 */
export { SHELTER_REGISTRY_DB };

export function startSheltersLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(namedLocalDb(SHELTER_REGISTRY_DB), queryClient, (type) => {
		if (type === 'shelter') {
			return [sheltersKeys.list(), [...sheltersKeys.all, 'detail']];
		}
		if (type === 'audit') {
			// Audit log changes don't directly affect shelter queries today,
			// but forward-compatibility: they could power a timeline view.
			return [];
		}
		return [];
	});
}
