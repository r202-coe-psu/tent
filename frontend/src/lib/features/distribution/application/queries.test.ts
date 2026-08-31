// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryDefinition = {
	queryKey: unknown;
	queryFn: () => Promise<unknown>;
	enabled: boolean;
};

type MutationDefinition = {
	mutationFn: (variables: unknown) => Promise<unknown>;
	onSuccess: (data: unknown, variables: unknown) => void;
};

const mocks = vi.hoisted(() => ({
	listRequests: vi.fn(),
	createRequest: vi.fn(),
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
		createRequest = mocks.createRequest;
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

import {
	distributionKeys,
	useCancelDistributionRequest,
	useCreateDistributionRequest,
	useDistributionRequests
} from './queries';

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

describe('Distribution Phase 4B create mutation', () => {
	it('calls createRequest with exact input and invalidates requests cache on success', async () => {
		useCreateDistributionRequest();
		const mutation = mocks.mutation;
		expect(mutation).not.toBeNull();

		const variables = {
			input: {
				purpose: 'Water and relief items',
				active_headcount_snapshot: '100',
				buffer_percent: 10,
				items: [
					{
						item_id: 'item:water',
						requested_qty: '110',
						unit: 'bottle',
						distribution_type_snapshot: 'consumable' as const,
						target_qty_snapshot: '110'
					}
				]
			},
			ctx: {
				shelterCode: 'SH001',
				createdBy: 'registration_user',
				roles: ['registration_staff']
			}
		};

		const createdRequest = {
			_id: 'distribution_request:01JCREATE',
			...variables.input,
			status: 'pending',
			shelter_code: 'SH001',
			created_by: 'registration_user',
			requested_by: 'registration_user',
			created_at: '2026-08-31T12:00:00.000Z',
			updated_at: '2026-08-31T12:00:00.000Z',
			schema_v: 1
		};
		mocks.createRequest.mockResolvedValue(createdRequest);

		const result = await mutation!.mutationFn(variables);
		mutation!.onSuccess(result, variables);

		expect(mocks.createRequest).toHaveBeenCalledWith(variables.input, variables.ctx);
		expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: distributionKeys.requests('SH001')
		});
	});

	it('propagates failure and does not invalidate caches when createRequest fails', async () => {
		useCreateDistributionRequest();
		const mutation = mocks.mutation;
		expect(mutation).not.toBeNull();

		const variables = {
			input: {
				purpose: 'Water and relief items',
				active_headcount_snapshot: '100',
				buffer_percent: 10,
				items: []
			},
			ctx: {
				shelterCode: 'SH001',
				createdBy: 'registration_user',
				roles: ['registration_staff']
			}
		};

		mocks.createRequest.mockRejectedValue(new Error('Validation error: items required'));

		await expect(mutation!.mutationFn(variables)).rejects.toThrow(
			'Validation error: items required'
		);
		expect(mocks.invalidateQueries).not.toHaveBeenCalled();
	});
});
