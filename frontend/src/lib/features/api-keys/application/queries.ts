import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { createApiKey, listApiKeys, revokeApiKey } from '../data/api-keys.api';

export const apiKeysKeys = {
	all: ['api-keys'] as const,
	list: () => [...apiKeysKeys.all, 'list'] as const
};

export const useApiKeys = () =>
	createQuery(() => ({
		queryKey: apiKeysKeys.list(),
		queryFn: listApiKeys
	}));

export const useCreateApiKey = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { name: string; owner: string; expires_at: string }) => createApiKey(input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeysKeys.all })
	}));
};

export const useRevokeApiKey = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (id: string) => revokeApiKey(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeysKeys.all })
	}));
};
