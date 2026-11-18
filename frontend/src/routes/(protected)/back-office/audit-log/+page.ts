import { requireManager } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireManager(fetch);
}) satisfies PageLoad;
