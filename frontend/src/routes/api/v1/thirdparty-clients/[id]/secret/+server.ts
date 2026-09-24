/**
 * SA-only BFF — reveal a third-party OAuth2 client's plaintext secret again, gated
 * behind the caller re-entering their own CouchDB password (EXT-001, ADR 0002;
 * draft-partner-client-secret-reveal-edit-delete).
 *
 * POST { password } → verify against CouchDB `_session` (no new cookie set), then
 * FastAPI `GET /v1/admin/thirdparty-clients/{id}/secret` (decrypts server-side).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	authorizeUserWrite,
	serviceError,
	ServiceError,
	verifyOwnPassword
} from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import { thirdPartyClientSecretRevealLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

function fastapiErrorMessage(body: unknown, fallback: string): string {
	if (typeof body !== 'object' || body === null) return fallback;
	const envelope = body as { errors?: unknown[]; detail?: unknown; error?: unknown };
	const first = Array.isArray(envelope.errors) ? envelope.errors[0] : undefined;
	if (typeof first === 'string' && first.trim()) return first;
	if (typeof first === 'object' && first !== null) {
		const msg =
			(first as { message?: unknown; msg?: unknown }).message ?? (first as { msg?: unknown }).msg;
		if (typeof msg === 'string' && msg.trim()) return msg;
	}
	if (typeof envelope.detail === 'string' && envelope.detail.trim()) return envelope.detail;
	if (typeof envelope.error === 'string' && envelope.error.trim()) return envelope.error;
	return fallback;
}

function serviceCodeForStatus(status: number): ServiceError['code'] {
	if (status === 401) return 'UNAUTHENTICATED';
	if (status === 403) return 'FORBIDDEN';
	if (status === 404) return 'VALIDATION';
	if (status === 409) return 'CONFLICT';
	if (status === 422 || status === 400) return 'VALIDATION';
	return 'INTERNAL';
}

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
		const respBody = await res.json().catch(() => null);
		if (!res.ok) {
			const message = fastapiErrorMessage(respBody, `Upstream request failed (${res.status})`);
			return json(
				{ error: { code: serviceCodeForStatus(res.status), message } },
				{ status: res.status >= 400 && res.status < 600 ? res.status : 502 }
			);
		}
		return json(respBody, { status: res.status });
	} catch (e) {
		return serviceError(e);
	}
};
