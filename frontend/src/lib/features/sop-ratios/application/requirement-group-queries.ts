import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { authStore } from '$lib/stores/auth.svelte';
import { requirementGroupRepository } from '../data/requirement-group.remote';
import type { RequirementGroupInput } from '../domain/requirement-group';

export const requirementGroupKeys = {
	all: ['sop_ratios', 'requirement_groups'] as const,
	list: (shelterCode?: string) => [...requirementGroupKeys.all, 'list', shelterCode ?? ''] as const,
	detail: (id: string, shelterCode?: string) =>
		[...requirementGroupKeys.all, 'detail', id, shelterCode ?? ''] as const
};

export const useRequirementGroups = (shelterCode?: string | (() => string | undefined)) => {
	const getCode = typeof shelterCode === 'function' ? shelterCode : () => shelterCode;
	return createQuery(() => {
		const code = getCode();
		return {
			queryKey: requirementGroupKeys.list(code),
			queryFn: () => requirementGroupRepository().listAll(code)
		};
	});
};

export const useSaveRequirementGroup = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			id,
			input,
			shelterCode
		}: {
			id: string;
			input: RequirementGroupInput;
			shelterCode?: string;
		}) => {
			const createdBy = authStore.user?.name ?? 'unknown';
			const repo = requirementGroupRepository();
			return repo.save(id, input, { createdBy, shelterCode });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: requirementGroupKeys.all });
			toast.success('บันทึกกลุ่มความต้องการสำเร็จ');
		},
		onError: (error: Error) => {
			toast.error(`บันทึกกลุ่มความต้องการไม่สำเร็จ: ${error.message}`);
		}
	}));
};

export const useDeleteRequirementGroup = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, shelterCode }: { id: string; shelterCode?: string }) => {
			const repo = requirementGroupRepository();
			await repo.delete(id, shelterCode);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: requirementGroupKeys.all });
			toast.success('ปิดใช้งานกลุ่มความต้องการสำเร็จ');
		},
		onError: (error: Error) => {
			toast.error(`ปิดใช้งานกลุ่มความต้องการไม่สำเร็จ: ${error.message}`);
		}
	}));
};

export const useSetRequirementGroupStatus = () => {
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
			const repo = requirementGroupRepository();
			await repo.setStatus(id, status, shelterCode);
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: requirementGroupKeys.all });
			toast.success(
				variables.status === 'active'
					? 'เปิดใช้งานกลุ่มความต้องการสำเร็จ'
					: 'ปิดใช้งานกลุ่มความต้องการสำเร็จ'
			);
		},
		onError: (error: Error) => {
			toast.error(`เปลี่ยนสถานะกลุ่มความต้องการไม่สำเร็จ: ${error.message}`);
		}
	}));
};
