import { error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, fetch }) => {
	await requireAdmin(fetch);
	if (params.mode !== 'create' && params.mode !== 'edit') error(404, 'Page not found');
	if (params.mode === 'edit' && !params.id) error(400, 'Missing shelter ID for edit mode');
	return { mode: params.mode, id: params.id };
}) satisfies PageLoad;
