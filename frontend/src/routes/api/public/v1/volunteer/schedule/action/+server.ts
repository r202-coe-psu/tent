import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { portalCredentialSchema, isMintedTicketToken } from '$lib/features/volunteer-portal/server';
import {
	volunteerTicketFindLimiter,
	volunteerTicketLimiter
} from '$lib/server/security/rate-limiter';
import {
	applyPublicScheduleAction,
	PublicScheduleError
} from '$lib/features/volunteers/server/public-schedule-action';

export const prerender = false;

const actionBodySchema = z.union([
	portalCredentialSchema.options[0].extend({
		assignment_id: z.string().trim().min(1).max(120),
		action: z.enum(['check_in', 'check_out', 'withdraw'])
	}),
	portalCredentialSchema.options[1].extend({
		assignment_id: z.string().trim().min(1).max(120),
		action: z.enum(['check_in', 'check_out', 'withdraw'])
	})
]);

/** Volunteer-owned check-in, check-out and withdrawal action. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// A minted `TKT-VOL-` token is 128 random bits and cannot be guessed, so it gets the
	// looser token budget; a phone (or any other code) keeps the strict lookup budget that
	// guards enumeration. Sharing the strict one throttled the second volunteer to sign in
	// from a shelter's single NAT address (#625, CR-127 note).
	// The budget follows the PARSED credential — the one the lookup will actually use. A
	// body carrying both a phone and a token parses as the phone (the token is stripped),
	// so judging the raw body would let a phone lookup ride the looser token budget.
	const body: unknown = await request.json().catch(() => null);
	const parsed = actionBodySchema.safeParse(body);
	const limiter =
		parsed.success && isMintedTicketToken(parsed.data)
			? volunteerTicketLimiter
			: volunteerTicketFindLimiter;
	if (!limiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const { assignment_id, action, ...credential } = parsed.data;
		return json(await applyPublicScheduleAction(credential, assignment_id, action), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		if (error instanceof PublicScheduleError) {
			return json({ success: false, error: error.code }, { status: error.httpStatus });
		}
		return json({ success: false, error: 'ACTION_FAILED' }, { status: 503 });
	}
};
