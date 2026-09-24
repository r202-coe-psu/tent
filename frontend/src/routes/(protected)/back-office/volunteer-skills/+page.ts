import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/** Legacy URL → Master Data hub */
export const load = (() => {
	redirect(302, resolve('/back-office/master-data?type=volunteer_skills'));
}) satisfies PageLoad;
