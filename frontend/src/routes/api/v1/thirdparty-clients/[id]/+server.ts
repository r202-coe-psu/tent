/**
 * SA-only BFF — edit scopes / soft-delete a third-party OAuth2 client (EXT-001,
 * ADR 0002; CR-136).
 *
 * PATCH { allowed_scopes } → FastAPI `PATCH /v1/admin/thirdparty-clients/{id}`
 *   (refused 409 once the client is revoked).
 * DELETE → FastAPI `DELETE /v1/admin/thirdparty-clients/{id}` (soft-delete; refused
 *   409 unless the client is already revoked).
 */
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders, proxyFastapiJson } from '$lib/server/fastapi';

export const prerender = false;

function requireId(params: { id?: string }): string {
	const id = typeof params.id === 'string' ? params.id.trim() : '';
	if (!id) throw new ServiceError('VALIDATION', 'id is required');
	return id;
}

interface UpdateBody {
	allowed_scopes?: unknown;
}

/** PATCH { allowed_scopes } — edit scopes while the client is still active. */
export const PATCH: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can manage third-party clients');
		}
		const id = requireId(params);

		const body = (await request.json().catch(() => ({}))) as UpdateBody;
		const allowed_scopes = Array.isArray(body.allowed_scopes)
			? body.allowed_scopes.filter((s): s is string => typeof s === 'string')
			: [];
		if (allowed_scopes.length === 0) {
			throw new ServiceError('VALIDATION', 'allowed_scopes must have at least one scope');
		}

		const res = await fetch(
			`${fastapiBaseUrl()}/v1/admin/thirdparty-clients/${encodeURIComponent(id)}`,
			{
				method: 'PATCH',
				headers: fastapiServiceHeaders({
					Accept: 'application/json',
					'Content-Type': 'application/json'
				}),
				body: JSON.stringify({ allowed_scopes })
			}
		);
		return proxyFastapiJson(res);
	} catch (e) {
		return serviceError(e);
	}
};

/** DELETE — soft-delete; only once the client has already been revoked. */
export const DELETE: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can manage third-party clients');
		}
		const id = requireId(params);

		const res = await fetch(
			`${fastapiBaseUrl()}/v1/admin/thirdparty-clients/${encodeURIComponent(id)}`,
			{ method: 'DELETE', headers: fastapiServiceHeaders({ Accept: 'application/json' }) }
		);
		return proxyFastapiJson(res);
	} catch (e) {
		return serviceError(e);
	}
};
