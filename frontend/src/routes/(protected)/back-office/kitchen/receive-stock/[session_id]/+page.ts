import { requireTicketAccess } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireTicketAccess(fetch);
}) satisfies PageLoad;
