import { requireWarehouse } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireWarehouse(fetch);
}) satisfies PageLoad;
