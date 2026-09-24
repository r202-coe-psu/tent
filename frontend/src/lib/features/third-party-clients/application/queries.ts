import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	createThirdPartyClient,
	deleteThirdPartyClient,
	listThirdPartyClients,
	revealThirdPartyClientSecret,
	revokeThirdPartyClient,
	updateThirdPartyClientScopes
} from '../data/third-party-clients.api';
import type {
	CreateThirdPartyClientInput,
	UpdateThirdPartyClientScopesInput
} from '../domain/third-party-client';

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

export const useUpdateThirdPartyClientScopes = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, input }: { id: string; input: UpdateThirdPartyClientScopesInput }) =>
			updateThirdPartyClientScopes(id, input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: thirdPartyClientsKeys.all })
	}));
};

export const useDeleteThirdPartyClient = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (id: string) => deleteThirdPartyClient(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: thirdPartyClientsKeys.all })
	}));
};

/** Not invalidated — revealing a secret doesn't change list state. */
export const useRevealThirdPartyClientSecret = () =>
	createMutation(() => ({
		mutationFn: ({ id, password }: { id: string; password: string }) =>
			revealThirdPartyClientSecret(id, password)
	}));
