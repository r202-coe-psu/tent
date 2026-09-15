import { error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/guards/auth';
import { siteKindSchema } from '$lib/features/shelters';
import type { PageLoad } from './$types';

export const load = (async ({ params, fetch, url }) => {
	await requireAdmin(fetch);
	if (params.mode !== 'create' && params.mode !== 'edit') error(404, 'Page not found');
	if (params.mode === 'edit' && !params.id) error(400, 'Missing shelter ID for edit mode');
	const parsedSiteKind = siteKindSchema.safeParse(url.searchParams.get('site_kind'));
	return {
		mode: params.mode,
		id: params.id,
		siteKind: parsedSiteKind.success ? parsedSiteKind.data : undefined
	};
}) satisfies PageLoad;
