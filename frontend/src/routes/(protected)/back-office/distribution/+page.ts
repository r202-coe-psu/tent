import { deskFallbackForBackOfficeParams } from '$lib/features/distribution';
import { requireWarehouseAccess } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, url }) => {
	// Pool links work for desk-only staff too: they land on the desk returns tab instead of /portal.
	await requireWarehouseAccess(fetch, {
		deskFallback: deskFallbackForBackOfficeParams(url.searchParams)
	});
}) satisfies PageLoad;
