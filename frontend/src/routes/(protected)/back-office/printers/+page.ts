import { requirePrinterManagement } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requirePrinterManagement(fetch);
}) satisfies PageLoad;
