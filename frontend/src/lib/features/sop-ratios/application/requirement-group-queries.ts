import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { authStore } from '$lib/stores/auth.svelte';
import { isSystemAdmin } from '$lib/auth/roles';
import { sheltersRepository, type ShelterSummary } from '$lib/features/shelters';
import { requirementGroupRepository } from '../data/requirement-group.remote';
import {
	findActiveItemMapConflicts,
	requirementGroupInputSchema,
	type RequirementGroup,
	type RequirementGroupInput
} from '../domain/requirement-group';

export const requirementGroupKeys = {
	all: ['sop_ratios', 'requirement_groups'] as const,
	list: (shelterCode?: string) => [...requirementGroupKeys.all, 'list', shelterCode ?? ''] as const,
	detail: (id: string, shelterCode?: string) =>
		[...requirementGroupKeys.all, 'detail', id, shelterCode ?? ''] as const
};

type RequirementGroupReader = Pick<
	ReturnType<typeof requirementGroupRepository>,
	'listAll' | 'listAllStrict'
>;

type ValidationDependencies = {
	repository: RequirementGroupReader;
	listShelters: () => Promise<Pick<ShelterSummary, 'code'>[]>;
};

export async function assertUniqueRequirementGroupItemMaps(
	id: string,
	input: RequirementGroupInput,
	shelterCode?: string,
	dependencies: ValidationDependencies = {
		repository: requirementGroupRepository(),
		listShelters: () => sheltersRepository().listShelters()
	}
): Promise<void> {
	const candidate = requirementGroupInputSchema.parse(input);
	if ((candidate.status ?? 'active') !== 'active') return;

	const candidateGroup = {
		_id: id,
		name: candidate.name,
		status: candidate.status,
		item_maps: candidate.item_maps
	};
	const actualSource =
		candidate.source === 'SHELTER_OVERRIDE' && shelterCode ? 'SHELTER_OVERRIDE' : 'SPHERE_BASELINE';
	const scopes: Array<{ shelterCode?: string; groups: RequirementGroup[] }> = [];

	if (actualSource === 'SHELTER_OVERRIDE') {
		scopes.push({ shelterCode, groups: await dependencies.repository.listAllStrict(shelterCode!) });
	} else {
		scopes.push({ groups: await dependencies.repository.listAll() });
		const shelters = await dependencies.listShelters();
		const effectiveGroups = await Promise.all(
			shelters.map(async (shelter) => ({
				shelterCode: shelter.code,
				groups: await dependencies.repository.listAllStrict(shelter.code)
			}))
		);
		scopes.push(...effectiveGroups);
	}

	const conflicts = scopes.flatMap(({ shelterCode: scopeCode, groups }) => {
		if (
			actualSource === 'SPHERE_BASELINE' &&
			scopeCode &&
			groups.some((group) => group._id === id && group.source === 'SHELTER_OVERRIDE')
		) {
			return [];
		}
		return findActiveItemMapConflicts(candidateGroup, groups).map((conflict) => ({
			...conflict,
			shelter_code: scopeCode
		}));
	});

	if (conflicts.length > 0) {
		const descriptions = [
			...new Set(
				conflicts.map(
					(conflict) =>
						`${conflict.item_id} อยู่ในกลุ่ม "${conflict.group_name}"` +
						(conflict.shelter_code ? ` ของศูนย์ ${conflict.shelter_code}` : '')
				)
			)
		];
		throw new Error(`บันทึกไม่ได้: ${descriptions.join('; ')}`);
	}
}

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
			if (
				(input.source !== 'SHELTER_OVERRIDE' || !shelterCode) &&
				!isSystemAdmin(authStore.user?.roles ?? [])
			) {
				throw new Error('ต้องเป็นผู้ดูแลระบบเพื่อแก้ไขกลุ่มความต้องการส่วนกลาง');
			}
			await assertUniqueRequirementGroupItemMaps(id, input, shelterCode, {
				repository: repo,
				listShelters: () => sheltersRepository().listShelters()
			});
			return repo.save(id, input, { createdBy, shelterCode });
		},
		// Returned so `mutateAsync` resolves only after the list has refetched: the form closes back
		// to that list, and an edit opened from a stale row would show the values just replaced.
		onSuccess: () => {
			toast.success('บันทึกกลุ่มความต้องการสำเร็จ');
			return queryClient.invalidateQueries({ queryKey: requirementGroupKeys.all });
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
			if (status === 'active') {
				const group = await repo.get(id, shelterCode);
				if (group) {
					if (
						(group.source !== 'SHELTER_OVERRIDE' || !shelterCode) &&
						!isSystemAdmin(authStore.user?.roles ?? [])
					) {
						throw new Error('ต้องเป็นผู้ดูแลระบบเพื่อเปิดใช้กลุ่มความต้องการส่วนกลาง');
					}
					await assertUniqueRequirementGroupItemMaps(id, { ...group, status }, shelterCode, {
						repository: repo,
						listShelters: () => sheltersRepository().listShelters()
					});
				}
			}
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
