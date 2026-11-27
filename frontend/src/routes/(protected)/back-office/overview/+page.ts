import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Bare /back-office/overview has no content of its own — land on the first dashboard.
export const load = (({ url }) => {
	redirect(307, `${resolve('/back-office/overview/evacuees')}${url.search}`);
}) satisfies PageLoad;
