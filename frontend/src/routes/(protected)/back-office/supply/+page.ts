import { requireWarehouseAccess } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async () => {
	await requireWarehouseAccess();
}) satisfies PageLoad;
