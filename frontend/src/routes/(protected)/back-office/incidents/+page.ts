import { requireIncidents } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireIncidents(fetch);
}) satisfies PageLoad;
