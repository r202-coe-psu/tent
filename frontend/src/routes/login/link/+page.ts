import { redirect } from '@sveltejs/kit';
import { redirectIfAuthenticated } from '$lib/guards/auth';
import { fetchPendingLink } from '$lib/features/login';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await redirectIfAuthenticated(undefined, fetch);
	const pending = await fetchPendingLink(fetch);
	if (!pending) redirect(307, '/login?error=link_expired');
	return { pending };
}) satisfies PageLoad;
