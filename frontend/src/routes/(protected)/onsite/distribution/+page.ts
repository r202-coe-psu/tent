import { requireDistributionDesk } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireDistributionDesk(fetch);
}) satisfies PageLoad;
