import { deskFallbackForBackOfficeParams } from '$lib/features/distribution';
import { requireWarehouseAccess } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, url, untrack }) => {
	// Pool links work for desk-only staff too: they land on the desk returns tab instead of /portal.
	// Read untracked so view/pool query changes don't rerun the load (and the auth round trip).
	await requireWarehouseAccess(fetch, {
		deskFallback: untrack(() => deskFallbackForBackOfficeParams(url.searchParams))
	});
}) satisfies PageLoad;
