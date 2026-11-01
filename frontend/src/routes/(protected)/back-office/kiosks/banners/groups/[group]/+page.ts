import { requireBannerManagement } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireBannerManagement(fetch);
}) satisfies PageLoad;
