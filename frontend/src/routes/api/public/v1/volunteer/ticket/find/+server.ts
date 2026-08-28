import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ticketFindSchema } from '$lib/features/volunteers/server';
import { volunteerTicketFindLimiter } from '$lib/server/security/rate-limiter';
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
	if (!volunteerTicketFindLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const parsed = ticketFindSchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/ticket/find`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ phone: parsed.data.phone })
		});
		if (!res.ok) {
			return json({ success: false, error: 'FIND_FAILED' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'FIND_FAILED' }, { status: 503 });
	}
};
