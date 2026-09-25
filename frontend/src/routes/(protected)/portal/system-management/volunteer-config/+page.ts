import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/** Legacy portal URL → Master Data hub */
export const load = (() => {
	redirect(302, resolve('/system-management/master-data?type=volunteer_skills'));
}) satisfies PageLoad;
