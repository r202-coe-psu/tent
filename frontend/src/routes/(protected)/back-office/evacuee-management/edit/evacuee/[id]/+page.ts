import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, fetch }) => {
	await requireEvacueeRegistration(fetch);
	return {
		id: params.id
	};
}) satisfies PageLoad;
