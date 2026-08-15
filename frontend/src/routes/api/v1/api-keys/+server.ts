/**
 * SA-only BFF for external API key management.
 * Proxies to FastAPI `/v1/admin/api-keys` with `EXTERNAL_API_SECRET` (server-only).
 * Caller must be `system_admin` (or Couch `_admin`) via Couch `_session`.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

const ADMIN_KEYS = '/v1/admin/api-keys';

async function requireSystemAdmin(cookie: string | null) {
	const caller = await authorizeUserWrite(cookie);
	if (!caller.isSA) {
		throw new ServiceError('FORBIDDEN', 'Only system admins can manage API keys');
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

/** GET — list API keys (metadata only; no secrets). */
export const GET: RequestHandler = async ({ request }) => {
	try {
		await requireSystemAdmin(request.headers.get('cookie'));
		const res = await fetch(`${fastapiBaseUrl()}${ADMIN_KEYS}`, {
			headers: fastapiServiceHeaders({ Accept: 'application/json' })
		});
		return proxyJson(res);
	} catch (e) {
		return serviceError(e);
	}
};

interface CreateBody {
	name?: unknown;
	owner?: unknown;
	expires_at?: unknown;
}

/** POST { name, owner, expires_at } — create key; response includes plaintext `api_key` once. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await requireSystemAdmin(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as CreateBody;

		const name = typeof body.name === 'string' ? body.name.trim() : '';
		const owner = typeof body.owner === 'string' ? body.owner.trim() : '';
		const expires_at = typeof body.expires_at === 'string' ? body.expires_at.trim() : '';

		if (!name) throw new ServiceError('VALIDATION', 'name is required');
		if (!owner) throw new ServiceError('VALIDATION', 'owner is required');
		if (!expires_at) throw new ServiceError('VALIDATION', 'expires_at is required');
		const expiresMs = Date.parse(expires_at);
		if (Number.isNaN(expiresMs)) {
			throw new ServiceError('VALIDATION', 'expires_at must be a valid ISO datetime');
		}
		if (expiresMs <= Date.now()) {
			throw new ServiceError('VALIDATION', 'expires_at must be in the future');
		}

		const res = await fetch(`${fastapiBaseUrl()}${ADMIN_KEYS}`, {
			method: 'POST',
			headers: fastapiServiceHeaders({
				Accept: 'application/json',
				'Content-Type': 'application/json'
			}),
			// FastAPI requires { name, owner, expires_at, created_by }; created_by is
			// injected from the verified SA session so the admin plane never trusts
			// client-supplied identity.
			body: JSON.stringify({ name, owner, expires_at, created_by: caller.name })
		});
		return proxyJson(res);
	} catch (e) {
		return serviceError(e);
	}
};
