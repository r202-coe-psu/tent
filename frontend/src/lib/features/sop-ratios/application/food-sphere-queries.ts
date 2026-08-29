import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { authStore } from '$lib/stores/auth.svelte';
import { foodSphereRepository } from '../data/food-sphere.remote';
import type { FoodSphereStandardInput } from '../domain/food-sphere';

export const foodSphereKeys = {
	all: ['sop_ratios', 'food_sphere_standards'] as const,
	list: (shelterCode?: string) => [...foodSphereKeys.all, 'list', shelterCode ?? ''] as const,
	detail: (id: string, shelterCode?: string) =>
		[...foodSphereKeys.all, 'detail', id, shelterCode ?? ''] as const
};

export const useFoodSphereStandards = (shelterCode?: string | (() => string | undefined)) => {
	const getCode = typeof shelterCode === 'function' ? shelterCode : () => shelterCode;
	return createQuery(() => {
		const code = getCode();
		return {
			queryKey: foodSphereKeys.list(code),
			queryFn: () => foodSphereRepository().listAll(code)
		};
	});
};

export const useSaveFoodSphereStandard = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			id,
			input,
			shelterCode
		}: {
			id: string;
			input: FoodSphereStandardInput;
			shelterCode?: string;
		}) => {
			const createdBy = authStore.user?.name ?? 'unknown';
			const repo = foodSphereRepository();
			return repo.save(id, input, { createdBy, shelterCode });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: foodSphereKeys.all });
			toast.success('บันทึกเกณฑ์โภชนาการมาตรฐานสำเร็จ');
		},
		onError: (error: Error) => {
			toast.error(`บันทึกเกณฑ์โภชนาการไม่สำเร็จ: ${error.message}`);
		}
	}));
};

export const useDeleteFoodSphereOverride = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, shelterCode }: { id: string; shelterCode?: string }) => {
			const repo = foodSphereRepository();
			await repo.delete(id, shelterCode);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: foodSphereKeys.all });
			toast.success('ปิดใช้งานเกณฑ์โภชนาการสำเร็จ');
		},
		onError: (error: Error) => {
			toast.error(`ปิดใช้งานเกณฑ์โภชนาการไม่สำเร็จ: ${error.message}`);
		}
	}));
};

export const useSetFoodSphereStandardStatus = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			id,
			status,
			shelterCode
		}: {
			id: string;
			status: 'active' | 'inactive';
			shelterCode?: string;
		}) => {
			const repo = foodSphereRepository();
			await repo.setStatus(id, status, shelterCode);
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: foodSphereKeys.all });
			toast.success(
				variables.status === 'active'
					? 'เปิดใช้งานเกณฑ์โภชนาการสำเร็จ'
					: 'ปิดใช้งานเกณฑ์โภชนาการสำเร็จ'
			);
		},
		onError: (error: Error) => {
			toast.error(`เปลี่ยนสถานะเกณฑ์โภชนาการไม่สำเร็จ: ${error.message}`);
		}
	}));
};
