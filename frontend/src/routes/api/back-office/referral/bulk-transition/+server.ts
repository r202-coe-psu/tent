/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from '../_auth';
import {
	BULK_TRANSITION_MAX_IDS,
	bulkTransition
} from '$lib/features/referrals/server/referral.bulk-transition';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';
import { referralStatusSchema } from '$lib/features/referrals/domain/referral.schema';

export const prerender = false;

const BACK_OFFICE_SCOPE = 'internal' as const;

const bulkTransitionBodySchema = z.object({
	ids: z
		.array(z.string().trim().min(1))
		.min(1, 'ids must not be empty')
		.max(BULK_TRANSITION_MAX_IDS, `ids must not exceed ${BULK_TRANSITION_MAX_IDS} items`)
		.refine((ids) => new Set(ids).size === ids.length, 'ids must be unique'),
	to: referralStatusSchema,
	reason: z.string().trim().max(2000, 'Reason exceeds maximum length of 2000 characters').optional()
});

/**
 * POST /api/back-office/referral/bulk-transition  (CR-167 FR-B1)
 * Body: `{ ids: string[], to: ReferralStatus, reason?: string }` → `{ succeeded, failed }`.
 *
 * Partial success, no rollback. All logic lives in `bulkTransition()` (shared with the referral
 * worker); this route only authenticates, validates and passes the session identity through.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const body = await request.json().catch(() => null);
		const parsed = bulkTransitionBodySchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 422 });
		}

		const { ids, to, reason } = parsed.data;
		const result = await bulkTransition(ids, to, reason || undefined, caller.name, shelterCode);
		return json({
			succeeded: result.succeeded.map((doc) => redactForScope(doc, BACK_OFFICE_SCOPE)),
			failed: result.failed
		});
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API Bulk Transition POST');
	}
};
