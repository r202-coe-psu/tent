import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { getShelterCode } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { authStore } from '$lib/stores/auth.svelte';
import type { DistributionRequestInput, DistributionRequestStatus } from '../domain/distribution';
import { DistributionRemoteRepository } from '../data/distribution.remote';

export const distributionKeys = {
	all: ['distribution'] as const,
	requests: (shelterCode: string) => [...distributionKeys.all, 'requests', shelterCode] as const,
	request: (shelterCode: string, requestId: string) =>
		[...distributionKeys.requests(shelterCode), requestId] as const,
	batches: (shelterCode: string) => [...distributionKeys.all, 'batches', shelterCode] as const,
	batch: (shelterCode: string, batchId: string) =>
		[...distributionKeys.batches(shelterCode), batchId] as const
};

const distributionRepository = () => new DistributionRemoteRepository();

function currentDistributionContext(shelterCode: string): AuthorContext {
	const user = authStore.user;
	if (!user?.name) {
		throw new Error('Unauthorized: no authenticated distribution user');
	}
	return { shelterCode, createdBy: user.name, roles: user.roles };
}

export const useDistributionRequests = (
	status: () => DistributionRequestStatus | undefined = () => undefined,
	shelterCode: () => string = getShelterCode
) =>
	createQuery(() => ({
		queryKey: [...distributionKeys.requests(shelterCode()), status() ?? 'all'] as const,
		queryFn: () => {
			const code = shelterCode();
			return distributionRepository().listRequests(status(), currentDistributionContext(code));
		},
		enabled: !!shelterCode() && !!authStore.user?.name
	}));

export const useCreateDistributionRequest = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: DistributionRequestInput; ctx: AuthorContext }) =>
			distributionRepository().createRequest(input, ctx),
		onSuccess: (_request, { ctx }) => {
			queryClient.invalidateQueries({ queryKey: distributionKeys.requests(ctx.shelterCode) });
		}
	}));
};

export const useCancelDistributionRequest = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ requestId, ctx }: { requestId: string; ctx: AuthorContext }) =>
			distributionRepository().cancelRequest(requestId, ctx),
		onSuccess: (_request, { requestId, ctx }) => {
			queryClient.invalidateQueries({ queryKey: distributionKeys.requests(ctx.shelterCode) });
			queryClient.invalidateQueries({
				queryKey: distributionKeys.request(ctx.shelterCode, requestId)
			});
		}
	}));
};
