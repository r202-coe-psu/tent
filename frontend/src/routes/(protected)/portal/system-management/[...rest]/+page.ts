import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Compatibility: /portal/system-management/* → /system-management/* */
export const load = (({ params, url }) => {
	const rest = params.rest ?? '';
	const target = rest
		? `/system-management/${rest}${url.search}`
		: `/system-management${url.search}`;
	redirect(307, target);
}) satisfies PageLoad;
