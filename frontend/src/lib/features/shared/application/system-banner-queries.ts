import { createQuery } from '@tanstack/svelte-query';
import { fetchSystemBanner } from '../data/system-banner.api';

const REFRESH_MS = 5 * 60 * 1000;

export const systemBannerKeys = {
	all: ['system-banner'] as const
};

/** Public banner settings; re-checked on window focus and every 5 minutes. */
export const useSystemBanner = () =>
	createQuery(() => ({
		queryKey: systemBannerKeys.all,
		queryFn: () => fetchSystemBanner(),
		staleTime: REFRESH_MS,
		refetchInterval: REFRESH_MS,
		refetchOnWindowFocus: true,
		retry: false
	}));
