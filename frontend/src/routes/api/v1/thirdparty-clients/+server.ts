/**
 * SA-only BFF for third-party OAuth2 client management (EXT-001, ADR 0002).
 * Proxies to FastAPI `/v1/admin/thirdparty-clients` with `EXTERNAL_API_SECRET` (server-only).
 * Caller must be `system_admin` (or Couch `_admin`) via Couch `_session`.
 */
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders, proxyFastapiJson } from '$lib/server/fastapi';

export const prerender = false;

const ADMIN_CLIENTS = '/v1/admin/thirdparty-clients';

async function requireSystemAdmin(cookie: string | null) {
	const caller = await authorizeUserWrite(cookie);
	if (!caller.isSA) {
		throw new ServiceError('FORBIDDEN', 'Only system admins can manage third-party clients');
	}
	return caller;
}

/** GET — list third-party clients (metadata only; no secrets). */
export const GET: RequestHandler = async ({ request }) => {
	try {
		await requireSystemAdmin(request.headers.get('cookie'));
		const res = await fetch(`${fastapiBaseUrl()}${ADMIN_CLIENTS}`, {
			headers: fastapiServiceHeaders({ Accept: 'application/json' })
		});
		return proxyFastapiJson(res);
	} catch (e) {
		return serviceError(e);
	}
};

interface CreateBody {
	name?: unknown;
	description?: unknown;
	module_name?: unknown;
	allowed_scopes?: unknown;
}

/**
 * POST { name, description?, module_name, allowed_scopes } — FastAPI generates `client_id`
 * (`tpc_…`); response includes plaintext `client_secret` once.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		await requireSystemAdmin(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as CreateBody;

		const name = typeof body.name === 'string' ? body.name.trim() : '';
		const description =
			typeof body.description === 'string' && body.description.trim()
				? body.description.trim()
				: null;
		const module_name = typeof body.module_name === 'string' ? body.module_name.trim() : '';
		const allowed_scopes = Array.isArray(body.allowed_scopes)
			? body.allowed_scopes.filter((s): s is string => typeof s === 'string')
			: [];

		if (!name) throw new ServiceError('VALIDATION', 'name is required');
		if (!module_name) throw new ServiceError('VALIDATION', 'module_name is required');
		if (allowed_scopes.length === 0) {
			throw new ServiceError('VALIDATION', 'allowed_scopes must have at least one scope');
		}

		const res = await fetch(`${fastapiBaseUrl()}${ADMIN_CLIENTS}`, {
			method: 'POST',
			headers: fastapiServiceHeaders({
				Accept: 'application/json',
				'Content-Type': 'application/json'
			}),
			body: JSON.stringify({ name, description, module_name, allowed_scopes })
		});
		return proxyFastapiJson(res);
	} catch (e) {
		return serviceError(e);
	}
};
