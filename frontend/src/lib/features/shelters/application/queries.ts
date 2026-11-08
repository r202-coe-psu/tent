import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { ServiceRequestError } from '$lib/api/service';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { sheltersRepository, SHELTER_REGISTRY_DB } from '../data/shelters.remote';
import {
	createShelter,
	updateShelter,
	closeZone,
	reopenZone,
	getShelterClosePreview,
	closeShelter,
	getStoragePoints,
	addStoragePoint,
	editStoragePoint,
	deleteStoragePoint,
	type StoragePointInput
} from '../data/shelters.api';
import { listProvinces, listDistricts, listSubdistricts } from '../data/thailand-location.api';
import type { Shelter } from '../domain/schema';

export const sheltersKeys = {
	all: ['shelters'] as const,
	list: () => [...sheltersKeys.all, 'list'] as const,
	search: () => [...sheltersKeys.all, 'search'] as const,
	detail: (code: string) => [...sheltersKeys.all, 'detail', code] as const,
	storagePoints: (code: string) => [...sheltersKeys.all, 'storage-points', code] as const,
	closePreview: (code: string) => [...sheltersKeys.all, 'close-preview', code] as const
};

export const useShelters = () =>
	createQuery(() => ({
		queryKey: sheltersKeys.list(),
		queryFn: () => sheltersRepository().listShelters()
	}));

export const useSearchShelters = () =>
	createQuery(() => ({
		queryKey: sheltersKeys.search(),
		queryFn: () => sheltersRepository().searchShelters()
	}));

export const useShelter = (code: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: sheltersKeys.detail(code()),
		queryFn: () => sheltersRepository().getShelter(code()),
		enabled: !!code() && enabled()
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
		mutationFn: ({ code, input, rev }: { code: string; input: Partial<Shelter>; rev?: string }) =>
			updateShelter(code, input, rev),
		// The detail refetch is awaited before toasting so the edit form (which waits on this
		// mutation) sees the doc it must reload from the moment the save is reported.
		onSuccess: async (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			await queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
			toast.success(`อัปเดตข้อมูลศูนย์พักพิง ${variables.code} สำเร็จ`);
		},
		onError: async (err: Error, variables) => {
			// Stale `_rev` (409): refetch so the form reloads the latest doc; unsaved edits are replaced.
			await queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
			if (err instanceof ServiceRequestError && err.status === 409) {
				toast.error('ข้อมูลศูนย์ถูกแก้ไขโดยผู้อื่น โหลดข้อมูลล่าสุดให้แล้ว กรุณาแก้ไขซ้ำอีกครั้ง');
				return;
			}
			toast.error(err.message || 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
		}
	}));
};

/** CR-219 FR-7: live preview of who the close touches; fetched only while the modal is open. */
export const useShelterClosePreview = (code: () => string, enabled: () => boolean) =>
	createQuery(() => ({
		queryKey: sheltersKeys.closePreview(code()),
		queryFn: () => getShelterClosePreview(code()),
		enabled: !!code() && enabled(),
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	}));

/**
 * CR-219 FR-8: close the shelter (check out everyone first). Toasting is left to the caller —
 * the result decides between success and the "failed N" message. Only list/search caches are
 * refreshed here; the caller refreshes the detail (the edit form re-seeds itself from it, so a
 * refetch mid-save would drop the user's other edits).
 */
export const useCloseShelter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ code, confirmText }: { code: string; confirmText: string }) =>
			closeShelter(code, confirmText),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.list() });
			queryClient.invalidateQueries({ queryKey: sheltersKeys.search() });
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
			zoneName?: string;
			reason?: string;
			closedBy?: string;
		}) => closeZone(code, zoneCode, reason, closedBy),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			const label = variables.zoneName?.trim() || variables.zoneCode;
			toast.success(`ปิดโซน ${label} ของศูนย์ ${variables.code} เรียบร้อย`);
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
			zoneName?: string;
			reopenedBy?: string;
		}) => reopenZone(code, zoneCode, reopenedBy),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.detail(variables.code) });
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			const label = variables.zoneName?.trim() || variables.zoneCode;
			toast.success(`เปิดโซน ${label} ของศูนย์ ${variables.code} อีกครั้ง`);
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

// ===== Storage points ("จัดการคลัง", #1186) =====

/** The shelter's points and the `_rev` writes must quote; always re-read, never served stale. */
export const useStoragePointsAdmin = (code: () => string) =>
	createQuery(() => ({
		queryKey: sheltersKeys.storagePoints(code()),
		queryFn: () => getStoragePoints(code()),
		enabled: !!code(),
		staleTime: 0
	}));

/**
 * Add (no `pointId`) or edit one storage point. `rev` is the `_rev` of the snapshot the user saw;
 * a 409 (someone saved the shelter meanwhile) re-reads the snapshot so the next try quotes a fresh one.
 */
export const useSaveStoragePoint = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			code,
			rev,
			pointId,
			point
		}: {
			code: string;
			rev: string;
			pointId?: string;
			point: StoragePointInput;
		}) =>
			pointId ? editStoragePoint(code, pointId, rev, point) : addStoragePoint(code, rev, point),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			toast.success(variables.pointId ? 'บันทึกจุดเก็บของสำเร็จ' : 'เพิ่มจุดเก็บของสำเร็จ');
		},
		onError: (err: Error, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.storagePoints(variables.code) });
			toast.error(err.message || 'บันทึกจุดเก็บของไม่สำเร็จ');
		}
	}));
};

export const useDeleteStoragePoint = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ code, rev, pointId }: { code: string; rev: string; pointId: string }) =>
			deleteStoragePoint(code, pointId, rev),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			toast.success('ลบจุดเก็บของสำเร็จ');
		},
		onError: (err: Error, variables) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.storagePoints(variables.code) });
			toast.error(err.message || 'ลบจุดเก็บของไม่สำเร็จ');
		}
	}));
};
