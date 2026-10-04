import { requireKitchen } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireKitchen(fetch);
}) satisfies PageLoad;
