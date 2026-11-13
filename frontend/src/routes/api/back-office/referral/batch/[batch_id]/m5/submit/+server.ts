/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';
import { submitM5Batch } from '$lib/features/referrals/server/referral.m5.server';
import {
	assertReferralTypeAllowed,
	authorizeReferral,
	resolveShelterCode
} from '../../../../_auth';
import { batchContext, m5ErrorResponse } from '../../../../_m5';

export const prerender = false;

/**
 * POST /api/back-office/referral/batch/[batch_id]/m5/submit — send the whole batch to M5
 * (`draft → sent`, TRF-002). Safe to repeat: M5 replays the same `external_ref`.
 */
export const POST: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeReferral(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		assertReferralTypeAllowed(caller, shelterCode, 'medical-emergency');

		const result = await submitM5Batch(batchContext(caller, shelterCode), params.batch_id);
		return json(
			{
				code: result.transfer.code,
				status: result.transfer.status,
				items: result.referrals.map((r) => redactForScope(r, 'internal')),
				failed: result.failed
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (e: unknown) {
		return m5ErrorResponse(e, 'Referral M5 submit POST');
	}
};
