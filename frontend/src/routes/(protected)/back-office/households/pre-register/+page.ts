import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async () => {
	await requireEvacueeRegistration();
	return {};
}) satisfies PageLoad;
