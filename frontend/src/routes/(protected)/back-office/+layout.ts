import { requireAuth } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireAuth(fetch);
}) satisfies LayoutLoad;
