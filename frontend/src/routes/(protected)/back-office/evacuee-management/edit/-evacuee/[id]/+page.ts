import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params }) => {
	await requireEvacueeRegistration();
	return {
		id: params.id
	};
}) satisfies PageLoad;
