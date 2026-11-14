/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';
import { startM5Batch } from '$lib/features/referrals/server/referral.m5.server';
import {
	assertReferralTypeAllowed,
	authorizeReferral,
	resolveShelterCode
} from '../../../../_auth';
import { batchContext, m5ErrorResponse } from '../../../../_m5';

export const prerender = false;

/**
 * POST /api/back-office/referral/batch/[batch_id]/m5/start — tell M5 the shelter's vehicle
 * has left (TRF-005). Only after MOPH approved (`external.status = pending`, rule 5).
 */
export const POST: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeReferral(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		assertReferralTypeAllowed(caller, shelterCode, 'medical-emergency');

		const result = await startM5Batch(batchContext(caller, shelterCode), params.batch_id);
		return json(
			{ items: result.referrals.map((r) => redactForScope(r, 'internal')), failed: result.failed },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (e: unknown) {
		return m5ErrorResponse(e, 'Referral M5 start POST');
	}
};
