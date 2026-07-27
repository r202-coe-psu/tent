import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load = (async ({ params }) => {
	await requireEvacueeRegistration();
	if (!params.id) {
		error(400, 'Missing household ID for edit mode');
	}
	return {
		id: params.id
	};
}) satisfies PageLoad;
