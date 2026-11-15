/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	allowedReferralTypes,
	assertReferralTypeAllowed,
	authorizeReferral,
	resolveShelterCode,
	handleEndpointError
} from '../../_auth';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';
import {
	ReferralConflictError,
	transitionWithRetry
} from '$lib/features/referrals/server/referral.transition-retry';
import { referralStatusSchema } from '$lib/features/referrals/domain/referral.schema';
import { ExternallyManagedError } from '$lib/features/referrals/domain/referral.m5';

export const prerender = false;

/**
 * PATCH /api/back-office/referral/[id]/transition
 * Transition the referral state with conflict (409) retry.
 *
 * Capacity referrals (all transitions) use this BFF path:
 * - `sent` writes the referral doc in `central_ops` only (no copy in the destination DB)
 * - `accepted`/`rejected` require the **destination** shelter scope (DoD)
 * - `accepted` runs cross-DB transfer via adminRaw before status write
 */
export const PATCH: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeReferral(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
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

		const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;
		if (reason && reason.length > 2000) {
			return json({ error: 'Reason exceeds maximum length of 2000 characters' }, { status: 422 });
		}

		const repo = new CouchDbReferralServerRepository('central_ops', shelterCode);
		// Role-limited callers (medical staff, D16) may only touch medical referrals.
		if (allowedReferralTypes(caller, shelterCode)) {
			const current = await repo.get(id);
			if (current) assertReferralTypeAllowed(caller, shelterCode, current.referral_type);
		}

		try {
			const updated = await transitionWithRetry(
				repo,
				id,
				nextStatus,
				caller.name,
				reason,
				shelterCode
			);
			return json(updated);
		} catch (e: unknown) {
			if (e instanceof ReferralConflictError) {
				return json({ error: e.message, details: e.details }, { status: 409 });
			}
			// M5 referrals: send/withdraw per batch, accept/reject from M5 only (CR §4).
			if (e instanceof ExternallyManagedError) {
				return json({ error: e.message, code: e.code }, { status: 409 });
			}
			throw e;
		}
	} catch (e: unknown) {
		if (e instanceof Error && e.message.includes('Invalid referral transition')) {
			return json({ error: e.message }, { status: 422 });
		}
		return handleEndpointError(e, 'Referral API Transition PATCH');
	}
};
