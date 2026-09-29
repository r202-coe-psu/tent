import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { dailySopRoleRepository } from '../data/daily-sop.remote';
import type { DailySopRoleAuthorContext } from '../data/daily-sop.repository';
import type {
	DailySopRoleAssessment,
	DailySopRoleCode,
	DailySopRoleDraft
} from '../domain/daily-sop';

export const dailySopKeys = {
	all: ['daily_sop_role_assessment'] as const,
	list: (shelterCode: string) => [...dailySopKeys.all, 'list', shelterCode] as const,
	detail: (id: string) => [...dailySopKeys.all, 'detail', id] as const
};

export const useDailySopRoleAssessments = (shelterCode: () => string) =>
	createQuery(() => ({
		queryKey: dailySopKeys.list(shelterCode()),
		queryFn: () => dailySopRoleRepository().list(shelterCode()),
		enabled: Boolean(shelterCode()),
		staleTime: 30_000
	}));

export const useDailySopRoleAssessment = (id: () => string | null) =>
	createQuery(() => ({
		queryKey: dailySopKeys.detail(id() ?? ''),
		queryFn: () => dailySopRoleRepository().read(id()!),
		enabled: Boolean(id()),
		staleTime: Infinity
	}));

export const useSaveDailySopRoleAssessment = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			role,
			draft,
			date,
			ctx
		}: {
			role: DailySopRoleCode;
			draft: DailySopRoleDraft;
			date: string;
			ctx: DailySopRoleAuthorContext;
		}) => dailySopRoleRepository().createOrUpdate(role, draft, date, ctx),
		onSuccess: (assessment) => {
			mergeIntoHistory(queryClient, assessment.shelter_code, assessment);
			queryClient.setQueryData(dailySopKeys.detail(assessment._id), assessment);
		}
	}));
};

function mergeIntoHistory(
	queryClient: ReturnType<typeof useQueryClient>,
	shelterCode: string,
	assessment: DailySopRoleAssessment
): void {
	queryClient.setQueryData<DailySopRoleAssessment[] | undefined>(
		dailySopKeys.list(shelterCode),
		(current) => {
			const next = [...(current?.filter((item) => item._id !== assessment._id) ?? []), assessment];
			return next.sort(
				(a, b) =>
					b.assessment_date.localeCompare(a.assessment_date) ||
					a.role_code.localeCompare(b.role_code)
			);
		}
	);
}
