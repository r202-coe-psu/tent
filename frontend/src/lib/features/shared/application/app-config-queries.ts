import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import type { AppConfig } from '../domain/app-config';
import { fetchAppConfig, updateAppConfig } from '../data/app-config.api';

export const appConfigKeys = {
	all: ['app-config'] as const,
	detail: () => [...appConfigKeys.all, 'detail'] as const
};

export const useAppConfig = () =>
	createQuery(() => ({
		queryKey: appConfigKeys.detail(),
		queryFn: () => fetchAppConfig()
	}));

export const useUpdateAppConfig = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (
			patch: Partial<Pick<AppConfig, 'recaptcha_enabled' | 'thaid_registration_enabled'>>
		) => updateAppConfig(patch),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: appConfigKeys.all })
	}));
};
