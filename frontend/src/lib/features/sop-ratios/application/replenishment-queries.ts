import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { authStore } from '$lib/stores/auth.svelte';
import { replenishmentPolicyRepository } from '../data/replenishment-policy.remote';
import type { ReplenishmentPolicyInput } from '../domain/replenishment-policy';

export const replenishmentKeys = {
	all: ['sop_ratios', 'replenishment_policies'] as const,
	list: (shelterCode?: string) => [...replenishmentKeys.all, 'list', shelterCode ?? ''] as const,
	detail: (id: string, shelterCode?: string) =>
		[...replenishmentKeys.all, 'detail', id, shelterCode ?? ''] as const
};

export const useReplenishmentPolicies = (shelterCode?: string | (() => string | undefined)) => {
	const getCode = typeof shelterCode === 'function' ? shelterCode : () => shelterCode;
	return createQuery(() => {
		const code = getCode();
		return {
			queryKey: replenishmentKeys.list(code),
			queryFn: () => replenishmentPolicyRepository().listAll(code)
		};
	});
};

export const useSaveReplenishmentPolicy = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			id,
			input,
			shelterCode
		}: {
			id: string;
			input: ReplenishmentPolicyInput;
			shelterCode?: string;
		}) => {
			const createdBy = authStore.user?.name ?? 'unknown';
			const repo = replenishmentPolicyRepository();
			return repo.save(id, input, { createdBy, shelterCode });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: replenishmentKeys.all });
			toast.success('บันทึกนโยบายการเติมสต็อกสำเร็จ');
		},
		onError: (error: Error) => {
			toast.error(`บันทึกนโยบายไม่สำเร็จ: ${error.message}`);
		}
	}));
};

export const useDeleteReplenishmentOverride = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, shelterCode }: { id: string; shelterCode?: string }) => {
			const repo = replenishmentPolicyRepository();
			await repo.delete(id, shelterCode);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: replenishmentKeys.all });
			toast.success('ปิดใช้งานนโยบายการเติมสต็อกสำเร็จ');
		},
		onError: (error: Error) => {
			toast.error(`ปิดใช้งานนโยบายไม่สำเร็จ: ${error.message}`);
		}
	}));
};

export const useSetReplenishmentPolicyStatus = () => {
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
			const repo = replenishmentPolicyRepository();
			await repo.setStatus(id, status, shelterCode);
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: replenishmentKeys.all });
			toast.success(
				variables.status === 'active'
					? 'เปิดใช้งานนโยบายการเติมสต็อกสำเร็จ'
					: 'ปิดใช้งานนโยบายการเติมสต็อกสำเร็จ'
			);
		},
		onError: (error: Error) => {
			toast.error(`เปลี่ยนสถานะนโยบายไม่สำเร็จ: ${error.message}`);
		}
	}));
};
