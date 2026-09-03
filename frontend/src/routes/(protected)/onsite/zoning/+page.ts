import { requireZoning } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireZoning(fetch);
}) satisfies PageLoad;
