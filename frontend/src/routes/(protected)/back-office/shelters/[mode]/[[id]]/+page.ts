import { requireAdmin, requireManager } from '$lib/guards/auth';
import type { PageLoad } from './$types';
import { siteKindSchema } from '$lib/features/shelters';
import { error } from '@sveltejs/kit';

export const load = (async ({ params, fetch, url }) => {
	if (params.mode === 'create') {
		await requireAdmin(fetch);
	} else {
		await requireManager(fetch);
	}
	if (params.mode !== 'create' && params.mode !== 'edit') {
		error(404, 'Page not found');
	}
	if (params.mode === 'edit' && !params.id) {
		error(400, 'Missing shelter ID for edit mode');
	}
	const parsedSiteKind = siteKindSchema.safeParse(url.searchParams.get('site_kind'));
	return {
		mode: params.mode,
		id: params.id,
		siteKind: parsedSiteKind.success ? parsedSiteKind.data : undefined
	};
}) satisfies PageLoad;
