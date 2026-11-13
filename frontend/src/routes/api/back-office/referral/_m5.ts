import { json } from '@sveltejs/kit';
import type { Caller } from '$lib/server/couch-admin';
import { IntegrationError } from '$lib/server/integrations';
import { M5BatchError } from '$lib/features/referrals/server/referral.m5.server';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';
import { handleEndpointError } from './_auth';

/** `{ error, code, …extra }` for M5 / integration failures; anything else as the other routes do. */
export function m5ErrorResponse(e: unknown, label: string) {
	if (e instanceof M5BatchError || e instanceof IntegrationError) {
		return json(
			{ error: e.message, code: e.code, ...e.extra },
			{ status: e.status, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	return handleEndpointError(e, label);
}

/** Batch context for the verified caller (actor and shelter never come from the body). */
export function batchContext(caller: Caller, shelterCode: string) {
	return {
		repo: new CouchDbReferralServerRepository('central_ops', shelterCode),
		shelterCode,
		actor: caller.name
	};
}
