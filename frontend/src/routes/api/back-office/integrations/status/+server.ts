import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIntegrationStatus } from '$lib/server/integrations';
import { authorizeReferral, handleEndpointError } from '../../referral/_auth';
import { authorizeCentralWarehouse } from '../../central-warehouse/_auth';

export const prerender = false;

const statusOf = (e: unknown): number | undefined => (e as { status?: number }).status;

/**
 * The status read serves two audiences (draft CRs M5 §2 and M6 §4): the referral audience (SA,
 * SM, medical staff) or the central-warehouse audience (SA, SM, warehouse staff). Try referral
 * first, then central warehouse; 403 only when neither admits the caller. A 401 ends it at once.
 */
async function authorizeEitherAudience(cookie: string | null, shelter: string | null) {
	try {
		return await authorizeReferral(cookie, shelter);
	} catch (referralError) {
		if (statusOf(referralError) === 401) throw referralError;
		try {
			return await authorizeCentralWarehouse(cookie, shelter);
		} catch (warehouseError) {
			// Surface the more specific failure: a 400 (shelter scope) beats a bare 403.
			throw statusOf(warehouseError) === 403 ? referralError : warehouseError;
		}
	}
}

/**
 * GET /api/back-office/integrations/status
 * → `{ m5: { state, checked_at }, m6: { state, checked_at, resource_types } }`
 *
 * Health gate for the OneData integrations. `state` is `ready`, `central_unreachable`,
 * `<sys>_unavailable`, `<sys>_not_configured` or `<sys>_credential_invalid`. Never 5xx for an
 * upstream outage: that is a state, not an error.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		await authorizeEitherAudience(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		return json(await getIntegrationStatus(), { headers: { 'Cache-Control': 'no-store' } });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Integrations status GET');
	}
};
