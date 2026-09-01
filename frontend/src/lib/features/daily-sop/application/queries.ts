import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import type { AuthorContext } from '$lib/db/model';
import { dailySopRepository } from '../data/daily-sop.remote';
import type { DailySopAssessment, DailySopDraft } from '../domain/daily-sop';

export const dailySopKeys = {
	all: ['daily_sop_assessment'] as const,
	list: (shelterCode: string) => [...dailySopKeys.all, 'list', shelterCode] as const,
	detail: (id: string) => [...dailySopKeys.all, 'detail', id] as const
};

export const useDailySopAssessments = (shelterCode: () => string) =>
	createQuery(() => ({
		queryKey: dailySopKeys.list(shelterCode()),
		queryFn: () => dailySopRepository().list(shelterCode()),
		enabled: Boolean(shelterCode()),
		staleTime: 30_000
	}));

export const useDailySopAssessment = (id: () => string | null) =>
	createQuery(() => ({
		queryKey: dailySopKeys.detail(id() ?? ''),
		queryFn: () => dailySopRepository().read(id()!),
		enabled: Boolean(id()),
		staleTime: Infinity
	}));

export const useCreateDailySop = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			draft,
			date,
			ctx
		}: {
			draft: DailySopDraft;
			date: string;
			ctx: AuthorContext;
		}) => dailySopRepository().createCompleted(draft, date, ctx),
		onSuccess: (result, variables) => {
			mergeIntoHistory(queryClient, variables.ctx.shelterCode, result.assessment);
		}
	}));
};

export const useUpdateDailySop = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			existing,
			draft,
			ctx
		}: {
			existing: DailySopAssessment;
			draft: DailySopDraft;
			ctx: AuthorContext;
		}) => dailySopRepository().updateCompleted(existing, draft, ctx),
		onSuccess: (assessment) => {
			mergeIntoHistory(queryClient, assessment.shelter_code, assessment);
			queryClient.setQueryData(dailySopKeys.detail(assessment._id), assessment);
		}
	}));
};

function mergeIntoHistory(
	queryClient: ReturnType<typeof useQueryClient>,
	shelterCode: string,
	assessment: DailySopAssessment
): void {
	queryClient.setQueryData<DailySopAssessment[] | undefined>(
		dailySopKeys.list(shelterCode),
		(current) => {
			const next = [...(current?.filter((item) => item._id !== assessment._id) ?? []), assessment];
			return next.sort(
				(a, b) =>
					b.assessment_date.localeCompare(a.assessment_date) ||
					b.assessed_at.localeCompare(a.assessed_at)
			);
		}
	);
}
