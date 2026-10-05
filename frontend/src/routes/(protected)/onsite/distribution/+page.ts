import { requireAuth } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireAuth(fetch);
}) satisfies PageLoad;
