/**
 * SA-only BFF — issue a new secret for an existing third-party OAuth2 client (EXT-001,
 * ADR 0002). The old secret stops working the instant this succeeds — the UI gates
 * this behind a destructive-action confirm dialog, not a password re-auth (unlike
 * secret reveal): this doesn't expose a hidden value, it invalidates one.
 *
 * POST → FastAPI `POST /v1/admin/thirdparty-clients/{id}/regenerate-secret`
 * (refused 409 once the client is revoked).
 */
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders, proxyFastapiJson } from '$lib/server/fastapi';

export const prerender = false;

export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can manage third-party clients');
		}

		const id = typeof params.id === 'string' ? params.id.trim() : '';
		if (!id) throw new ServiceError('VALIDATION', 'id is required');

		const res = await fetch(
			`${fastapiBaseUrl()}/v1/admin/thirdparty-clients/${encodeURIComponent(id)}/regenerate-secret`,
			{ method: 'POST', headers: fastapiServiceHeaders({ Accept: 'application/json' }) }
		);
		return proxyFastapiJson(res);
	} catch (e) {
		return serviceError(e);
	}
};
