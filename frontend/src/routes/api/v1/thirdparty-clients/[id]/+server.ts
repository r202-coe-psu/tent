/**
 * SA-only BFF — edit scopes / soft-delete a third-party OAuth2 client (EXT-001,
 * ADR 0002; draft-partner-client-secret-reveal-edit-delete).
 *
 * PATCH { allowed_scopes } → FastAPI `PATCH /v1/admin/thirdparty-clients/{id}`
 *   (refused 409 once the client is revoked).
 * DELETE → FastAPI `DELETE /v1/admin/thirdparty-clients/{id}` (soft-delete; refused
 *   409 unless the client is already revoked).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

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
		return proxyJson(res);
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
		return proxyJson(res);
	} catch (e) {
		return serviceError(e);
	}
};
