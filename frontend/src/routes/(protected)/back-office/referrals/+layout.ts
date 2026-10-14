import { requireManager } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

// One guard for the list, create, detail and batch routes.
export const load = (async ({ fetch }) => {
	await requireManager(fetch);
}) satisfies LayoutLoad;
