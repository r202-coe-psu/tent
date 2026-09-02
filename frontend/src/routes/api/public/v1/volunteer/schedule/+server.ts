import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import { volunteerTicketFindLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/**
 * ตารางทำงานจิตอาสา — the Access Portal's schedule (CR-092 หน้าจอ 6).
 *
 * Shares the lookup limiter with the ticket finder: both answer "is this person known",
 * so they have to share one budget or an attacker just alternates between them.
 *
 * Takes either sign-in credential — the phone the volunteer applied with, or the ticket
 * token behind the QR on their pass (CR-092 หน้าจอ 6). Both resolve to the same
 * `phone_hash` upstream, so the roster does not depend on which door they came through.
 *
 * Read-only. Accepting or declining a dispatched shift is a separate write path and is
 * not reachable from here.
 */
export const POST: RequestHandler = async ({ request, fetch, getClientAddress }) => {
	if (!volunteerTicketFindLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const parsed = portalCredentialSchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/schedule`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(parsed.data)
		});
		if (!res.ok) {
			return json({ success: false, error: 'SCHEDULE_UNAVAILABLE' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'SCHEDULE_UNAVAILABLE' }, { status: 503 });
	}
};
