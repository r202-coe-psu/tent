import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/db/couch';
import { setMfaOkCookie } from '$lib/server/google-oauth';
import { ServiceError, serviceError } from '$lib/server/couch-admin';

export const prerender = false;

/**
 * POST — Skip MFA challenge for the current session.
 * Sets the session-scoped `mfa_ok` cookie so the user can enter protected routes.
 */
export const POST: RequestHandler = async ({ fetch, cookies }) => {
	try {
		const session = await getSession(fetch);
		if (!session?.name) {
			throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
		}

		setMfaOkCookie(cookies, session.name);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
