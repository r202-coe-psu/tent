import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import type { AppConfig, AppConfigPatchKey } from '../domain/app-config';
import { fetchAppConfig, updateAppConfig } from '../data/app-config.api';
import { systemBannerKeys } from './system-banner-queries';

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
		mutationFn: (patch: Partial<Pick<AppConfig, AppConfigPatchKey>>) => updateAppConfig(patch),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: appConfigKeys.all }),
				queryClient.invalidateQueries({ queryKey: systemBannerKeys.all })
			])
	}));
};
