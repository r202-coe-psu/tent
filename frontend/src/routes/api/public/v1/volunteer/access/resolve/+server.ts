import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import { volunteerTicketFindLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

/** Resolve a phone or ticket credential before opening a URL-bound portal session. */
export const POST: RequestHandler = async ({ request, fetch, getClientAddress }) => {
	if (!volunteerTicketFindLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const parsed = portalCredentialSchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/access/resolve`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(parsed.data)
		});
		if (!res.ok) {
			return json({ success: false, error: 'ACCESS_UNAVAILABLE' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'ACCESS_UNAVAILABLE' }, { status: 503 });
	}
};
