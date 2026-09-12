import { requireMedicalScreening } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireMedicalScreening(fetch);
}) satisfies PageLoad;
