import { requireSupplyView } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireSupplyView(fetch);
}) satisfies PageLoad;
