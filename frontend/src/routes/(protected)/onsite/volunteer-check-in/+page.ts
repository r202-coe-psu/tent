import { requireVolunteerCheckIn } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireVolunteerCheckIn(fetch);
}) satisfies PageLoad;
