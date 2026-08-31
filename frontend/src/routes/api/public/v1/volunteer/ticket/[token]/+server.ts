import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { volunteerTicketLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/** Digital Pass (CR-092 screen 2). The token is the only credential. */
export const GET: RequestHandler = async ({ params, fetch, getClientAddress }) => {
	if (!volunteerTicketLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const res = await fetch(
			`${fastapiBaseUrl()}/public/v1/volunteer/ticket/${encodeURIComponent(params.token)}`,
			{ headers: fastapiServiceHeaders() }
		);
		if (!res.ok) {
			// Collapse every upstream failure to "not found": distinguishing them would
			// tell a scanner which tokens exist.
			return json(
				{ success: false, error: 'TICKET_NOT_FOUND' },
				{ status: res.status === 404 ? 404 : 502 }
			);
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 503 });
	}
};
