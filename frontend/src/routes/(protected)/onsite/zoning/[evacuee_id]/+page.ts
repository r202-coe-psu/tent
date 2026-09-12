import { requireZoning } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, params }) => {
	await requireZoning(fetch);
	return {
		evacueeId: params.evacuee_id
	};
}) satisfies PageLoad;
