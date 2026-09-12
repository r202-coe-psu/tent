import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireEvacueeRegistration(fetch);
}) satisfies PageLoad;
