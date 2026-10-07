import { redirectIfAuthenticated } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await redirectIfAuthenticated(undefined, fetch);
}) satisfies PageLoad;
