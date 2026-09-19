import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageLoad } from './$types';

/**
 * Legacy pass URL. CR-092 §5 puts the Digital Pass on `/volunteer/ticket/:token`, and
 * that is the one that resolves the token against the API — this path used to render a
 * second copy filled with fixture data, which showed a stranger's name for any token.
 */
export const load = (({ params }) => {
	redirect(308, `${base}/volunteer/ticket/${encodeURIComponent(params.token)}`);
}) satisfies PageLoad;
