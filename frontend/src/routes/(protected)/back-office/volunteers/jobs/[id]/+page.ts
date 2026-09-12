import { requireManager } from '$lib/guards/auth';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, params }) => {
	await requireManager(fetch);
	if (!params.id) {
		error(400, 'Missing job id');
	}
	return { id: params.id };
}) satisfies PageLoad;
