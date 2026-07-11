import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { isShelterManager } from '$lib/auth/roles';
import { ReferralRemoteRepository } from '$lib/features/referrals/data/referral.remote';

export const prerender = false;

async function authorizeReferral(cookie: string | null) {
	const caller = await requireShelterScopeOrSA(cookie);
	const allowed = caller.isSA || isShelterManager(caller.roles);
	if (!allowed) {
		throw error(403, 'Requires shelter_manager or system_admin role');
	}
	return caller;
}

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

		// Resolve which shelter db to query
		let shelterCode = url.searchParams.get('shelter_code') || undefined;
		if (!caller.isSA) {
			shelterCode = caller.shelterCode || undefined;
		} else {
			shelterCode = shelterCode || 'SH001';
		}

		if (!shelterCode) {
			return json({ error: 'Missing shelter_code scope' }, { status: 400 });
		}

		const repo = new ReferralRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
		const doc = await repo.get(id);

		if (!doc) {
			return json({ error: `Referral not found: ${id}` }, { status: 404 });
		}

		return json(doc);
	} catch (e: any) {
		const status = e.status || 500;
		const message = e.body?.message || e.message || 'Internal Server Error';
		return json({ error: message }, { status });
	}
};
