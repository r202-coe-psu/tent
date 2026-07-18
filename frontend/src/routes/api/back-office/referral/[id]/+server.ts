import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from '../_auth';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';

export const prerender = false;

/**
 * GET /api/back-office/referral/[id]
 * Fetch a single referral document.
 */
export const GET: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));
		const id = params.id;
		if (!id) {
			return json({ error: 'Missing ID parameter' }, { status: 400 });
		}

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const repo = new CouchDbReferralServerRepository(`shelter_${shelterCode.toLowerCase()}`);
		const doc = await repo.get(id);

		if (!doc) {
			return json({ error: `Referral not found: ${id}` }, { status: 404 });
		}

		return json(doc);
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API ID GET');
	}
};
