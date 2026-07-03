import { requireAdmin } from '$lib/guards/auth';
import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load = (async ({ params }) => {
	await requireAdmin(fetch);
	if (params.mode !== 'create' && params.mode !== 'edit') {
		error(404, 'Page not found');
	}
	if (params.mode === 'edit' && !params.id) {
		error(400, 'Missing shelter ID for edit mode');
	}
	return {
		mode: params.mode,
		id: params.id
	};
}) satisfies PageLoad;
