import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	createThirdPartyClient,
	listThirdPartyClients,
	revokeThirdPartyClient
} from '../data/third-party-clients.api';
import type { CreateThirdPartyClientInput } from '../domain/third-party-client';

export const thirdPartyClientsKeys = {
	all: ['third-party-clients'] as const,
	list: () => [...thirdPartyClientsKeys.all, 'list'] as const
};

export const useThirdPartyClients = () =>
	createQuery(() => ({
		queryKey: thirdPartyClientsKeys.list(),
		queryFn: listThirdPartyClients
	}));

export const useCreateThirdPartyClient = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: CreateThirdPartyClientInput) => createThirdPartyClient(input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: thirdPartyClientsKeys.all })
	}));
};

export const useRevokeThirdPartyClient = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (id: string) => revokeThirdPartyClient(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: thirdPartyClientsKeys.all })
	}));
};
