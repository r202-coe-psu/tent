import { createQuery } from '@tanstack/svelte-query';
import * as api from '../data/me.api';

export const meKeys = {
	all: ['me'] as const
};

export const useMe = () =>
	createQuery(() => ({
		queryKey: meKeys.all,
		queryFn: () => api.fetchMe()
	}));
