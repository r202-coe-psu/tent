import { requireAuth } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async () => {
	await requireAuth();
}) satisfies PageLoad;
