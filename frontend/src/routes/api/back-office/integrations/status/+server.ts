import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIntegrationStatus } from '$lib/server/integrations';
import { authorizeReferral, handleEndpointError } from '../../referral/_auth';

export const prerender = false;

/**
 * GET /api/back-office/integrations/status → `{ m5: { state, checked_at } }`
 *
 * Health gate for the M5 dispatch mode (draft CR — referral M5 §2). `state` is `ready`,
 * `central_unreachable`, `m5_unavailable`, `m5_not_configured` or `m5_credential_invalid`.
 * Never 5xx for an upstream outage: that is a state, not an error.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		await authorizeReferral(request.headers.get('cookie'), url.searchParams.get('shelter_code'));
		return json(await getIntegrationStatus(), { headers: { 'Cache-Control': 'no-store' } });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Integrations status GET');
	}
};
