/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from '../../_auth';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';

export const prerender = false;

/** See GET list handler — back-office is always internal scope. */
const BACK_OFFICE_SCOPE = 'internal' as const;

/**
 * GET /api/back-office/referral/[id]/batch
 * Siblings of the referral created in the same batch (same template, creator and 2-minute window).
 */
export const GET: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));
		const id = params.id;
		if (!id) {
			return json({ error: 'Missing ID parameter' }, { status: 400 });
		}

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const repo = new CouchDbReferralServerRepository('central_ops', shelterCode);
		const anchor = await repo.get(id);
		if (!anchor) {
			return json({ error: `Referral not found: ${id}` }, { status: 404 });
		}
		if (
			!caller.isSA &&
			anchor.shelter_code !== shelterCode &&
			anchor.to_shelter_code !== shelterCode
		) {
			return json({ error: 'Forbidden: You do not have access to this referral' }, { status: 403 });
		}

		const items = await repo.getBatchFor(anchor);
		return json({ items: items.map((doc) => redactForScope(doc, BACK_OFFICE_SCOPE)) });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API batch GET');
	}
};
