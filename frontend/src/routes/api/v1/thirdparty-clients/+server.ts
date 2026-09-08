/**
 * SA-only BFF for third-party OAuth2 client management (EXT-001, ADR 0002).
 * Proxies to FastAPI `/v1/admin/thirdparty-clients` with `EXTERNAL_API_SECRET` (server-only).
 * Caller must be `system_admin` (or Couch `_admin`) via Couch `_session`.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

const ADMIN_CLIENTS = '/v1/admin/thirdparty-clients';

async function requireSystemAdmin(cookie: string | null) {
	const caller = await authorizeUserWrite(cookie);
	if (!caller.isSA) {
		throw new ServiceError('FORBIDDEN', 'Only system admins can manage third-party clients');
	}
	return caller;
}

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
	if (status === 409) return 'CONFLICT';
	if (status === 422 || status === 400) return 'VALIDATION';
	return 'INTERNAL';
}

async function proxyJson(res: Response): Promise<Response> {
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		const message = fastapiErrorMessage(body, `Upstream request failed (${res.status})`);
		return json(
			{ error: { code: serviceCodeForStatus(res.status), message } },
			{ status: res.status >= 400 && res.status < 600 ? res.status : 502 }
		);
	}
	return json(body, { status: res.status });
}

/** GET — list third-party clients (metadata only; no secrets). */
export const GET: RequestHandler = async ({ request }) => {
	try {
		await requireSystemAdmin(request.headers.get('cookie'));
		const res = await fetch(`${fastapiBaseUrl()}${ADMIN_CLIENTS}`, {
			headers: fastapiServiceHeaders({ Accept: 'application/json' })
		});
		return proxyJson(res);
	} catch (e) {
		return serviceError(e);
	}
};

interface CreateBody {
	client_id?: unknown;
	module_name?: unknown;
	allowed_scopes?: unknown;
}

/** POST { client_id, module_name, allowed_scopes } — response includes plaintext `client_secret` once. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		await requireSystemAdmin(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as CreateBody;

		const client_id = typeof body.client_id === 'string' ? body.client_id.trim() : '';
		const module_name = typeof body.module_name === 'string' ? body.module_name.trim() : '';
		const allowed_scopes = Array.isArray(body.allowed_scopes)
			? body.allowed_scopes.filter((s): s is string => typeof s === 'string')
			: [];

		if (!client_id) throw new ServiceError('VALIDATION', 'client_id is required');
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
			body: JSON.stringify({ client_id, module_name, allowed_scopes })
		});
		return proxyJson(res);
	} catch (e) {
		return serviceError(e);
	}
};
