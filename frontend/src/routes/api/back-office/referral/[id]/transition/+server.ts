/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from '../../_auth';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';
import { referralStatusSchema } from '$lib/features/referrals/domain/referral.schema';

export const prerender = false;

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

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const body = await request.json().catch(() => ({}));
		const parsed = referralStatusSchema.safeParse(body.to);
		if (!parsed.success) {
			return json({ error: `Invalid transition status: ${body.to}` }, { status: 422 });
		}

		const nextStatus = parsed.data;
		const repo = new CouchDbReferralServerRepository(`shelter_${shelterCode.toLowerCase()}`);

		const MAX_RETRIES = 3;
		let lastError: { message?: string } | null = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				const updated = await repo.transition(id, nextStatus, caller.name);
				return json(updated);
			} catch (e: unknown) {
				const err = e as { status?: number; message?: string };
				// CouchDB put returns 409 conflict
				const isConflict =
					err.status === 409 ||
					err.message?.includes('409') ||
					err.message?.includes('conflict') ||
					err.message?.includes('Conflict');

				if (isConflict) {
					lastError = err;
					// Wait 50ms before retrying to mitigate write contention
					await new Promise((resolve) => setTimeout(resolve, 50));
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
	} catch (e: unknown) {
		if (e instanceof Error && e.message.includes('Invalid referral transition')) {
			return json({ error: e.message }, { status: 422 });
		}
		return handleEndpointError(e, 'Referral API Transition PATCH');
	}
};
