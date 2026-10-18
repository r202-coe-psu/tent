import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema, isMintedTicketToken } from '$lib/features/volunteer-portal/server';
import {
	volunteerTicketFindLimiter,
	volunteerTicketLimiter
} from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

/**
 * The signed-in volunteer's own profile (Access Portal edit screen).
 *
 * Shares the lookup budget with the ticket finder and the schedule: all three answer
 * "is this person known" from a guessable key, so they have to share one budget or an
 * attacker just alternates between them.
 *
 * Never cached — staff edit the same profile from the back office, and a cached copy
 * would show a name or a verification badge the shelter has already changed.
 */
export const POST: RequestHandler = async ({ request, fetch, getClientAddress }) => {
	// A minted `TKT-VOL-` token is 128 random bits and cannot be guessed, so it gets the
	// looser token budget; a phone (or any other code) keeps the strict lookup budget that
	// guards enumeration. Sharing the strict one throttled the second volunteer to sign in
	// from a shelter's single NAT address (#625, CR-127 note).
	const body: unknown = await request.json().catch(() => null);
	const limiter = isMintedTicketToken(body) ? volunteerTicketLimiter : volunteerTicketFindLimiter;
	if (!limiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const parsed = portalCredentialSchema.safeParse(body);
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/profile`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(parsed.data)
		});
		if (!res.ok) {
			return json({ success: false, error: 'PROFILE_UNAVAILABLE' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'PROFILE_UNAVAILABLE' }, { status: 503 });
	}
};
