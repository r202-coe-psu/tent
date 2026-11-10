import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTicketApplications } from '$lib/features/volunteers/server/public-ticket';

/**
 * The applications behind a pass token, for the portal's per-shift ticket buttons (#973).
 * The token is the only credential and only lists what it already owns: a permanent token
 * its volunteer's applications, an application token its single one. Unknown token = 404,
 * same as the pass itself.
 */
export const GET: RequestHandler = async ({ params }) => {
	const token = params.token?.trim();
	if (!token) return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 404 });
	try {
		const applications = await listTicketApplications(token);
		if (!applications) return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 404 });
		return json({ success: true, applications }, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'LOOKUP_FAILED' }, { status: 503 });
	}
};
