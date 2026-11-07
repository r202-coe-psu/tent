import { requireDonationAccess } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireDonationAccess(fetch);
}) satisfies PageLoad;
