import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import {
	listProvinces,
	listDistricts,
	listSubdistricts,
	createProvince,
	createDistrict,
	createSubdistrict,
	updateSubdistrictZipcode,
	deleteLocation,
	type SubdistrictEntry
} from '../data/location.api';

/**
 * TanStack Query wiring for the Thailand location manager (CR-037).
 * Reads cascade province → district → subdistrict; mutations invalidate the
 * affected level and toast on success/error.
 */

export const locationKeys = {
	all: ['thailand-location'] as const,
	provinces: () => [...locationKeys.all, 'provinces'] as const,
	districts: (province: string) => [...locationKeys.all, 'districts', province] as const,
	subdistricts: (province: string, district: string) =>
		[...locationKeys.all, 'subdistricts', province, district] as const
};

export function useProvinces() {
	return createQuery(() => ({
		queryKey: locationKeys.provinces(),
		queryFn: listProvinces
	}));
}

export function useDistricts(province: () => string | null) {
	return createQuery(() => ({
		queryKey: locationKeys.districts(province() ?? ''),
		queryFn: () => listDistricts(province()!),
		enabled: !!province()
	}));
}

export function useSubdistricts(province: () => string | null, district: () => string | null) {
	return createQuery(() => ({
		queryKey: locationKeys.subdistricts(province() ?? '', district() ?? ''),
		queryFn: () => listSubdistricts(province()!, district()!),
		enabled: !!province() && !!district()
	}));
}

function toastError(e: unknown) {
	toast.error(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ');
}

export function useCreateProvince() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: (name: string) => createProvince(name),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: locationKeys.provinces() });
			toast.success('เพิ่มจังหวัดสำเร็จ');
		},
		onError: toastError
	}));
}

export function useCreateDistrict() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ province, name }: { province: string; name: string }) =>
			createDistrict(province, name),
		onSuccess: (_d, { province }) => {
			qc.invalidateQueries({ queryKey: locationKeys.districts(province) });
			toast.success('เพิ่มอำเภอสำเร็จ');
		},
		onError: toastError
	}));
}

export function useCreateSubdistrict() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			province,
			district,
			name,
			zipcode
		}: {
			province: string;
			district: string;
			name: string;
			zipcode: number;
		}) => createSubdistrict(province, district, name, zipcode),
		onSuccess: (_d, { province, district }) => {
			qc.invalidateQueries({ queryKey: locationKeys.subdistricts(province, district) });
			toast.success('เพิ่มตำบลสำเร็จ');
		},
		onError: toastError
	}));
}

export function useUpdateZipcode() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			id,
			zipcode
		}: {
			id: string;
			zipcode: number;
			province: string;
			district: string;
		}) => updateSubdistrictZipcode(id, zipcode),
		onSuccess: (_d, { province, district }) => {
			qc.invalidateQueries({ queryKey: locationKeys.subdistricts(province, district) });
			toast.success('แก้ไขรหัสไปรษณีย์สำเร็จ');
		},
		onError: toastError
	}));
}

export function useDeleteLocation() {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id }: { id: string; invalidate: readonly unknown[] }) => deleteLocation(id),
		onSuccess: (_d, { invalidate }) => {
			qc.invalidateQueries({ queryKey: invalidate });
			toast.success('ลบสำเร็จ');
		},
		onError: toastError
	}));
}

export type { SubdistrictEntry };
