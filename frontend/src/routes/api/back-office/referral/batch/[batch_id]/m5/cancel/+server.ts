/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';
import { cancelM5Batch } from '$lib/features/referrals/server/referral.m5.server';
import {
	assertReferralTypeAllowed,
	authorizeReferral,
	resolveShelterCode
} from '../../../../_auth';
import { batchContext, m5ErrorResponse } from '../../../../_m5';

export const prerender = false;

const cancelBodySchema = z.object({
	reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ถอนคำขอ').max(2000),
	/** Withdraw, then recreate the batch as a new draft without these referral ids (rule 6). */
	resubmit_without: z.array(z.string().trim().min(1)).max(1000).optional()
});

/**
 * POST /api/back-office/referral/batch/[batch_id]/m5/cancel — withdraw the whole batch
 * (TRF-006, rule 3). Referrals close only after M5 accepted the withdrawal; a batch MOPH
 * already approved answers `409 CANCEL_NEEDS_MOPH`.
 */
export const POST: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeReferral(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		assertReferralTypeAllowed(caller, shelterCode, 'medical-emergency');

		const parsed = cancelBodySchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return json(
				{ error: parsed.error.issues[0]?.message ?? 'Invalid request', code: 'VALIDATION' },
				{ status: 422 }
			);
		}
		const result = await cancelM5Batch(
			batchContext(caller, shelterCode),
			params.batch_id,
			parsed.data.reason,
			parsed.data.resubmit_without
		);
		return json(
			{
				items: result.closed.map((r) => redactForScope(r, 'internal')),
				failed: result.failed,
				new_batch_id: result.new_batch_id
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (e: unknown) {
		return m5ErrorResponse(e, 'Referral M5 cancel POST');
	}
};
