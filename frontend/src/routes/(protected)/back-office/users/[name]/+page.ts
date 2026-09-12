import { requireManager } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, fetch }) => {
	await requireManager(fetch);
	return { name: params.name };
}) satisfies PageLoad;
