import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { sheltersRepository, SHELTER_REGISTRY_DB } from '../data/shelters.remote';
import { createShelter, updateShelter, closeZone, reopenZone } from '../data/shelters.api';
import { listProvinces, listDistricts, listSubdistricts } from '../data/thailand-location.api';
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

// ===== Thailand province/district/subdistrict cascade (address selects) =====

export const thailandLocationKeys = {
	all: ['thailand-location'] as const,
	provinces: () => [...thailandLocationKeys.all, 'provinces'] as const,
	districts: (province: string) => [...thailandLocationKeys.all, 'districts', province] as const,
	subdistricts: (province: string, district: string) =>
		[...thailandLocationKeys.all, 'subdistricts', province, district] as const
};

export const useProvinces = () =>
	createQuery(() => ({
		queryKey: thailandLocationKeys.provinces(),
		queryFn: listProvinces,
		staleTime: Infinity
	}));

export const useDistricts = (province: () => string | null) =>
	createQuery(() => ({
		queryKey: thailandLocationKeys.districts(province() ?? ''),
		queryFn: () => listDistricts(province()!),
		enabled: !!province(),
		staleTime: Infinity
	}));

export const useSubdistricts = (province: () => string | null, district: () => string | null) =>
	createQuery(() => ({
		queryKey: thailandLocationKeys.subdistricts(province() ?? '', district() ?? ''),
		queryFn: () => listSubdistricts(province()!, district()!),
		enabled: !!province() && !!district(),
		staleTime: Infinity
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
 * Wire CouchDB changes (event channel) to TanStack Query invalidations for the
 * shelter registry. Reactivity comes from replication (and local writes),
 * not from polling — covers cross-tab writes and remote-sync refreshes.
 *
 * Hook from the root layout alongside the people live query.
 */
export { SHELTER_REGISTRY_DB };

export function startSheltersLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, SHELTER_REGISTRY_DB, (type) => {
		if (type === 'shelter') {
			return [sheltersKeys.list(), [...sheltersKeys.all, 'detail']];
		}
		return [];
	});
}
