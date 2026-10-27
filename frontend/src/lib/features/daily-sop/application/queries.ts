import {
	createInfiniteQuery,
	createMutation,
	createQuery,
	useQueryClient
} from '@tanstack/svelte-query';
import { dailySopRoleRepository, fetchDailySopStockStatus } from '../data/daily-sop.remote';
import type { DailySopRoleAuthorContext } from '../data/daily-sop.repository';
import type {
	DailySopRoleAssessment,
	DailySopRoleCode,
	DailySopRoleDraft
} from '../domain/daily-sop';

export const dailySopKeys = {
	all: ['daily_sop_role_assessment'] as const,
	list: (shelterCode: string, asOfDate?: string) =>
		asOfDate
			? ([...dailySopKeys.all, 'list', shelterCode, asOfDate] as const)
			: ([...dailySopKeys.all, 'list', shelterCode] as const),
	detail: (id: string) => [...dailySopKeys.all, 'detail', id] as const,
	stockStatus: (shelterCode: string) => [...dailySopKeys.all, 'stock-status', shelterCode] as const
};

export const useDailySopRoleAssessments = (shelterCode: () => string, asOfDate: () => string) =>
	createInfiniteQuery(() => {
		const code = shelterCode();
		const date = asOfDate();
		return {
			queryKey: dailySopKeys.list(code, date),
			queryFn: ({ pageParam }) => dailySopRoleRepository().listPage(code, pageParam, date),
			initialPageParam: null as string | null,
			getNextPageParam: (lastPage) => lastPage.bookmark ?? undefined,
			enabled: Boolean(code),
			staleTime: 30_000
		};
	});

export const useResetDailySopRoleList = () => {
	const queryClient = useQueryClient();
	return (shelterCode: string) =>
		queryClient.resetQueries({ queryKey: dailySopKeys.list(shelterCode) });
};

export const useDailySopStockStatus = (shelterCode: () => string, enabled: () => boolean) =>
	createQuery(() => ({
		queryKey: dailySopKeys.stockStatus(shelterCode()),
		queryFn: () => fetchDailySopStockStatus(shelterCode()),
		enabled: Boolean(shelterCode()) && enabled(),
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
			ctx,
			baseAssessment
		}: {
			role: DailySopRoleCode;
			draft: DailySopRoleDraft;
			date: string;
			ctx: DailySopRoleAuthorContext;
			baseAssessment: DailySopRoleAssessment | null;
		}) => dailySopRoleRepository().createOrUpdate(role, draft, date, ctx, baseAssessment),
		onSuccess: async (assessment) => {
			queryClient.setQueryData(dailySopKeys.detail(assessment._id), assessment);
			await queryClient.resetQueries({ queryKey: dailySopKeys.list(assessment.shelter_code) });
		}
	}));
};
