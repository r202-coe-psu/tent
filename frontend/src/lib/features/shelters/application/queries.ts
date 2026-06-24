import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import {
	createShelter,
	listShelters,
	updateShelter,
	getShelter,
	closeZone,
	reopenZone
} from '../data/shelters.api';
import type { Shelter } from '../domain/schema';

export const sheltersKeys = {
	all: ['shelters'] as const,
	list: () => [...sheltersKeys.all, 'list'] as const,
	detail: (code: string) => [...sheltersKeys.all, 'detail', code] as const
};

export const useShelters = () =>
	createQuery(() => ({
		queryKey: sheltersKeys.list(),
		queryFn: listShelters
	}));

export const useShelter = (code: () => string) =>
	createQuery(() => ({
		queryKey: sheltersKeys.detail(code()),
		queryFn: () => getShelter(code()),
		enabled: !!code()
	}));

export const useCreateShelter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: Shelter) => createShelter(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			toast.success('บันทึกข้อมูลและสร้างศูนย์พักพิงสำเร็จ');
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
			toast.success('อัปเดตข้อมูลโครงสร้างศูนย์พักพิงสำเร็จ');
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
			toast.success(`ปิดโซน ${variables.zoneCode} เรียบร้อย`);
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
			toast.success(`เปิดโซน ${variables.zoneCode} อีกครั้ง`);
		},
		onError: (err: Error) => {
			toast.error(err.message || 'ไม่สามารถเปิดโซนได้');
		}
	}));
};
