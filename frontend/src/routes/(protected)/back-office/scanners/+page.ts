import { requireScannerManagement } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireScannerManagement(fetch);
}) satisfies PageLoad;
