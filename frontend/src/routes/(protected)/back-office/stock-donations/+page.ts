import { requireAdmin } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async () => {
	await requireAdmin();
}) satisfies PageLoad;
