import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema, isMintedTicketToken } from '$lib/features/volunteer-portal/server';
import {
	volunteerTicketFindLimiter,
	volunteerTicketLimiter
} from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/**
 * "ค้นหาตั๋วของฉัน" (CR-092 screen 1 tab 2).
 *
 * Held tighter than the other ticket routes: a phone number is guessable where a
 * 128-bit token is not, so this is the one volunteer surface that can be enumerated.
 * Upstream returns an empty list rather than a 404 on a miss, and this route keeps that
 * shape — a hit and a miss must be indistinguishable.
 */
export const POST: RequestHandler = async ({ request, fetch, getClientAddress }) => {
	// A minted `TKT-VOL-` token is 128 random bits and cannot be guessed, so it gets the
	// looser token budget; a phone (or any other code) keeps the strict lookup budget that
	// guards enumeration. Sharing the strict one throttled the second volunteer to sign in
	// from a shelter's single NAT address (#625, CR-127 note).
	// The budget follows the PARSED credential — the one the lookup will actually use. A
	// body carrying both a phone and a token parses as the phone (the token is stripped),
	// so judging the raw body would let a phone lookup ride the looser token budget.
	const body: unknown = await request.json().catch(() => null);
	const parsed = portalCredentialSchema.safeParse(body);
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
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/ticket/find`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(parsed.data)
		});
		if (!res.ok) {
			return json({ success: false, error: 'FIND_FAILED' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'FIND_FAILED' }, { status: 503 });
	}
};
