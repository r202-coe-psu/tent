import { requireAuth } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params }) => {
	await requireAuth();
	return {
		id: params.id
	};
}) satisfies PageLoad;
