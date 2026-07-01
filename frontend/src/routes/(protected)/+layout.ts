import { requireAuth } from '$lib/guards/auth';
import { authStore } from '$lib/stores/auth.svelte';
import type { LayoutLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireAuth(fetch);
	return {
		user: authStore.user,
		isAuthenticated: authStore.isAuthenticated
	};
}) satisfies LayoutLoad;
