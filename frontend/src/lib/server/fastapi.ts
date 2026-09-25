/**
 * Server-only FastAPI base URL + auth for BFF → public-plane calls.
 * Prefer FASTAPI_INTERNAL_URL (no PUBLIC_ prefix). PUBLIC_FASTAPI_PROXY is
 * legacy/dev fallback shared with Vite's path-specific proxy target.
 */
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { ServiceErrorCode } from './couch-admin';

export function fastapiBaseUrl(): string {
	return env.FASTAPI_INTERNAL_URL || env.PUBLIC_FASTAPI_PROXY || 'http://localhost:9000';
}

/** Headers for SvelteKit BFF → FastAPI (donations require EXTERNAL_API_SECRET). */
export function fastapiServiceHeaders(extra: Record<string, string> = {}): Record<string, string> {
	const headers: Record<string, string> = { ...extra };
	if (env.EXTERNAL_API_SECRET) {
		headers.Authorization = `Bearer ${env.EXTERNAL_API_SECRET}`;
	}
	return headers;
}

/**
 * Flatten FastAPI's `{ errors: [detail] }` envelope (see `apiapp/core/http_error.py`)
 * into the shape public BFF callers spread into `{ success: false, … }`.
 */
export function unwrapFastapiError(
	body: unknown,
	fallbackError = 'WRITE_FAILED'
): Record<string, unknown> {
	if (typeof body !== 'object' || body === null) return { error: fallbackError };
	const envelope = body as { errors?: unknown[] };
	const detail = Array.isArray(envelope.errors) ? envelope.errors[0] : undefined;
	if (typeof detail === 'object' && detail !== null) return detail as Record<string, unknown>;
	if (typeof detail === 'string') return { error: detail };
	return body as Record<string, unknown>;
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

function serviceCodeForStatus(status: number): ServiceErrorCode {
	if (status === 401) return 'UNAUTHENTICATED';
	if (status === 403) return 'FORBIDDEN';
	if (status === 404) return 'VALIDATION';
	if (status === 409) return 'CONFLICT';
	if (status === 422 || status === 400) return 'VALIDATION';
	return 'INTERNAL';
}

/**
 * Turn a FastAPI admin-proxy `Response` into the BFF's `{ error: { code, message } }`
 * envelope on failure, or pass the parsed body through unchanged on success.
 */
export async function proxyFastapiJson(res: Response): Promise<Response> {
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
