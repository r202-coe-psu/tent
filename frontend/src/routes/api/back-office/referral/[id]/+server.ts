/* eslint-disable no-restricted-imports */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { isShelterManager } from '$lib/auth/roles';
import { ReferralServerRepository } from '$lib/features/referrals/server/referral.server-repo';

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

		const repo = new ReferralServerRepository(`shelter_${shelterCode.toLowerCase()}`);
		const doc = await repo.get(id);

		if (!doc) {
			return json({ error: `Referral not found: ${id}` }, { status: 404 });
		}

		return json(doc);
	} catch (e: unknown) {
		console.error('🔴 [Referral API GET ID Error]:', e);
		const err = e as { status?: number; body?: { message?: string }; message?: string };
		const status = err.status || 500;
		const message = err.body?.message || err.message || 'Internal Server Error';
		return json({ error: message }, { status });
	}
};
