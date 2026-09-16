import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';
import { clearMfaOkCookie } from '$lib/server/google-oauth';
import { unlinkGoogleMfa } from '$lib/server/user-service';

export const prerender = false;

/**
 * POST — Unlink Google MFA.
 * Body empty / no name → self-unlink (clears mfa_ok cookie).
 * Body `{ name }` → admin/manager unlink (same authz as password reset).
 */
export const POST: RequestHandler = async ({ request, fetch, cookies }) => {
	try {
		const session = await getSession(fetch);
		if (!session?.name) {
			throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
		}

		const body = (await request.json().catch(() => ({}))) as { name?: unknown };
		const targetName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;

		if (!targetName || targetName === session.name) {
			await unlinkGoogleMfa(session.name);
			clearMfaOkCookie(cookies);
			return json({ ok: true });
		}

		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		await unlinkGoogleMfa(targetName, caller);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
