/**
 * SA-only BFF — issue a new secret for an existing third-party OAuth2 client (EXT-001,
 * ADR 0002). The old secret stops working the instant this succeeds — the UI gates
 * this behind a destructive-action confirm dialog, not a password re-auth (unlike
 * secret reveal): this doesn't expose a hidden value, it invalidates one.
 *
 * POST → FastAPI `POST /v1/admin/thirdparty-clients/{id}/regenerate-secret`
 * (refused 409 once the client is revoked).
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
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			const message = fastapiErrorMessage(body, `Upstream request failed (${res.status})`);
			return json(
				{ error: { code: serviceCodeForStatus(res.status), message } },
				{ status: res.status >= 400 && res.status < 600 ? res.status : 502 }
			);
		}
		return json(body, { status: res.status });
	} catch (e) {
		return serviceError(e);
	}
};
