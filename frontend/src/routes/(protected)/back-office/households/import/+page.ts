import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

/** RS + SA + SM may import people (CR-071 slice A / T-72). */
export const load = (async () => {
	await requireEvacueeRegistration();
	return {};
}) satisfies PageLoad;
