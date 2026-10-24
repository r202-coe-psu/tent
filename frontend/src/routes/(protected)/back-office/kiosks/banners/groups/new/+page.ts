import { requireKioskManagement } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireKioskManagement(fetch);
}) satisfies PageLoad;
