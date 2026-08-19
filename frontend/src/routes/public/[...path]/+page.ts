import { error, redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Legacy SPA paths under `/public/*` → same path at `/`.
 * Leaves `/public/v1/*` alone (API re-exports under `public/v1/`).
 */
export const load = (({ params, url }) => {
	const rest = params.path ?? '';
	if (!rest || rest === 'v1' || rest.startsWith('v1/')) {
		error(404, 'Not found');
	}
	redirect(301, `/${rest}${url.search}`);
}) satisfies PageLoad;
