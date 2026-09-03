import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, url }) => {
	await requireEvacueeRegistration(fetch);
	if (!url.searchParams.get('q')?.trim()) {
		throw redirect(302, resolve('/onsite/search-edit'));
	}
}) satisfies PageLoad;
