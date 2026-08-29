import { requireManager } from '$lib/guards/auth';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, params, url }) => {
	await requireManager(fetch);
	if (!params.id) {
		error(400, 'Missing job id');
	}
	// `?shift=` deep-links one sub-shift; absent means "the job's first shift".
	return { id: params.id, shiftId: url.searchParams.get('shift') ?? undefined };
}) satisfies PageLoad;
