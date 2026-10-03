import { requireZoning } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch, params, url }) => {
	await requireZoning(fetch);
	return {
		evacueeId: params.evacuee_id,
		/** Set by the Station 3 scan hand-off — scroll to and highlight the zone step. */
		focusZone: url.searchParams.get('focus') === 'zone'
	};
}) satisfies PageLoad;
