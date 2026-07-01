import { requireManager } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireManager(fetch);
}) satisfies LayoutLoad;
