import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, params }) => {
	await requireEvacueeRegistration(fetch);
	return { evacueeId: params.id };
}) satisfies PageLoad;
