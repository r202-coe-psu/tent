import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveLoginName } from '$lib/server/user-service';
import { loginResolveIpLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

/**
 * POST { identifier } — map username or contact phone → CouchDB `name`.
 * Always returns `{ ok, name }` (falls back to the input) so callers cannot
 * enumerate accounts from status alone. Does not create a session.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	if (!loginResolveIpLimiter.check(ip)) {
		return json({ ok: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	const body = (await request.json().catch(() => ({}))) as { identifier?: unknown };
	const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
	if (!identifier) {
		return json({ ok: false, error: 'identifier is required' }, { status: 400 });
	}

	const name = await resolveLoginName(identifier);
	return json({ ok: true, name });
};
