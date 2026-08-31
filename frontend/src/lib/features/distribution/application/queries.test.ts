// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';

type QueryDefinition = {
	queryKey: unknown;
	queryFn: () => Promise<unknown>;
	enabled: boolean;
};

type MutationDefinition = {
	mutationFn: (variables: { requestId: string; ctx: AuthorContext }) => Promise<unknown>;
	onSuccess: (data: unknown, variables: { requestId: string; ctx: AuthorContext }) => void;
};

const mocks = vi.hoisted(() => ({
	listRequests: vi.fn(),
	cancelRequest: vi.fn(),
	invalidateQueries: vi.fn(),
	query: null as QueryDefinition | null,
	mutation: null as MutationDefinition | null
}));

vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		user: { name: 'registration_user', roles: ['registration_staff'] }
	}
}));

vi.mock('../data/distribution.remote', () => ({
	DistributionRemoteRepository: class {
		listRequests = mocks.listRequests;
		cancelRequest = mocks.cancelRequest;
	}
}));

vi.mock('@tanstack/svelte-query', () => ({
	createQuery: (factory: () => QueryDefinition) => {
		mocks.query = factory();
		return mocks.query;
	},
	createMutation: (factory: () => MutationDefinition) => {
		mocks.mutation = factory();
		return mocks.mutation;
	},
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries })
}));

import { distributionKeys, useCancelDistributionRequest, useDistributionRequests } from './queries';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Distribution Phase 4A queries', () => {
	it('uses a shelter-scoped, stable request-list key and calls the real repository adapter', async () => {
		const query = useDistributionRequests(
			() => undefined,
			() => 'SH001'
		);
		mocks.listRequests.mockResolvedValue([]);
		const definition = mocks.query;
		expect(definition).not.toBeNull();

		expect(query).toBe(definition);
		expect(definition?.queryKey).toEqual([...distributionKeys.requests('SH001'), 'all']);
		expect(definition?.enabled).toBe(true);
		await definition?.queryFn();
		expect(mocks.listRequests).toHaveBeenCalledWith(undefined, {
			shelterCode: 'SH001',
			createdBy: 'registration_user',
			roles: ['registration_staff']
		});
	});

	it('calls cancelRequest and invalidates only related request caches after success', async () => {
		useCancelDistributionRequest();
		const mutation = mocks.mutation;
		expect(mutation).not.toBeNull();
		const variables = {
			requestId: 'distribution_request:01JQUERY',
			ctx: {
				shelterCode: 'SH001',
				createdBy: 'registration_user',
				roles: ['registration_staff']
			}
		};
		mocks.cancelRequest.mockResolvedValue({ _id: variables.requestId, status: 'cancelled' });

		const result = await mutation!.mutationFn(variables);
		mutation!.onSuccess(result, variables);

		expect(mocks.cancelRequest).toHaveBeenCalledWith(variables.requestId, variables.ctx);
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: distributionKeys.requests('SH001')
		});
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: distributionKeys.request('SH001', variables.requestId)
		});
	});

	it('does not invalidate request caches when cancellation fails', async () => {
		useCancelDistributionRequest();
		const mutation = mocks.mutation;
		expect(mutation).not.toBeNull();
		const variables = {
			requestId: 'distribution_request:01JQUERY',
			ctx: {
				shelterCode: 'SH001',
				createdBy: 'registration_user',
				roles: ['registration_staff']
			}
		};
		mocks.cancelRequest.mockRejectedValue(new Error('CouchDB conflict'));

		await expect(mutation!.mutationFn(variables)).rejects.toThrow('CouchDB conflict');
		expect(mocks.invalidateQueries).not.toHaveBeenCalled();
	});
});
