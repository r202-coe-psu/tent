import { createQuery } from '@tanstack/svelte-query';
import * as api from '../data/me.api';

export const meKeys = {
	all: ['me'] as const,
	card: () => [...meKeys.all, 'card'] as const
};

export const useMe = () =>
	createQuery(() => ({
		queryKey: meKeys.all,
		queryFn: () => api.fetchMe()
	}));

export const useMyCard = (enabled: () => boolean) =>
	createQuery(() => ({
		queryKey: meKeys.card(),
		queryFn: () => api.fetchMyCard(),
		enabled: enabled(),
		staleTime: 0,
		gcTime: 0
	}));
