import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { isShelterManager } from '$lib/auth/roles';
import { ReferralRemoteRepository } from '$lib/features/referrals/data/referral.remote';
import { referralStatusSchema } from '$lib/features/referrals/domain/referral.schema';

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
 * PATCH /api/back-office/referral/[id]/transition
 * Transition the referral state with conflict (409) retry.
 */
export const PATCH: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));
		const id = params.id;
		if (!id) {
			return json({ error: 'Missing ID parameter' }, { status: 400 });
		}

		// Resolve which shelter db to write to
		let shelterCode = url.searchParams.get('shelter_code') || undefined;
		if (!caller.isSA) {
			shelterCode = caller.shelterCode || undefined;
		} else {
			shelterCode = shelterCode || 'SH001';
		}

		if (!shelterCode) {
			return json({ error: 'Missing shelter_code scope' }, { status: 400 });
		}

		const body = await request.json().catch(() => ({}));
		const parsed = referralStatusSchema.safeParse(body.to);
		if (!parsed.success) {
			return json({ error: `Invalid transition status: ${body.to}` }, { status: 422 });
		}

		const nextStatus = parsed.data;
		const repo = new ReferralRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);

		const MAX_RETRIES = 3;
		let lastError: any = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				const updated = await repo.transition(id, nextStatus, caller.name);
				return json(updated);
			} catch (e: any) {
				// CouchDB put returns 409 conflict
				const isConflict =
					e.status === 409 ||
					e.message?.includes('409') ||
					e.message?.includes('conflict') ||
					e.message?.includes('Conflict');

				if (isConflict) {
					lastError = e;
					continue; // retry
				}
				throw e; // throw other errors immediately
			}
		}

		return json(
			{
				error: `Conflict: transition failed after ${MAX_RETRIES} attempts`,
				details: lastError?.message
			},
			{ status: 409 }
		);
	} catch (e: any) {
		const status = e.status || 500;
		const message = e.body?.message || e.message || 'Internal Server Error';
		return json({ error: message }, { status });
	}
};
