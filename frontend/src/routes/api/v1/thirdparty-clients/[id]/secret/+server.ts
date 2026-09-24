/**
 * SA-only BFF — reveal a third-party OAuth2 client's plaintext secret again, gated
 * behind the caller re-entering their own CouchDB password (EXT-001, ADR 0002;
 * draft-partner-client-secret-reveal-edit-delete).
 *
 * POST { password } → verify against CouchDB `_session` (no new cookie set), then
 * FastAPI `GET /v1/admin/thirdparty-clients/{id}/secret` (decrypts server-side).
 */
import type { RequestHandler } from './$types';
import {
	authorizeUserWrite,
	serviceError,
	ServiceError,
	verifyOwnPassword
} from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders, proxyFastapiJson } from '$lib/server/fastapi';
import { thirdPartyClientSecretRevealLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

interface RevealBody {
	password?: unknown;
}

export const POST: RequestHandler = async ({ request, params, getClientAddress }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can manage third-party clients');
		}

		const ip = getClientAddress();
		if (!thirdPartyClientSecretRevealLimiter.check(ip)) {
			throw new ServiceError('VALIDATION', 'Too many attempts — try again in a minute');
		}

		const id = typeof params.id === 'string' ? params.id.trim() : '';
		if (!id) throw new ServiceError('VALIDATION', 'id is required');

		const body = (await request.json().catch(() => ({}))) as RevealBody;
		const password = typeof body.password === 'string' ? body.password : '';
		if (!password) throw new ServiceError('VALIDATION', 'password is required');

		// Re-checks the session cookie itself — cheap, and keeps this route safe to
		// call standalone even if a future caller skips the outer authorizeUserWrite.
		await verifyOwnPassword(request.headers.get('cookie'), password);

		const res = await fetch(
			`${fastapiBaseUrl()}/v1/admin/thirdparty-clients/${encodeURIComponent(id)}/secret`,
			{ headers: fastapiServiceHeaders({ Accept: 'application/json' }) }
		);
		return proxyFastapiJson(res);
	} catch (e) {
		return serviceError(e);
	}
};
