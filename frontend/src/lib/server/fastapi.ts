/**
 * Server-only FastAPI base URL + auth for BFF → public-plane calls.
 * Prefer FASTAPI_INTERNAL_URL (no PUBLIC_ prefix). PUBLIC_FASTAPI_PROXY is
 * legacy/dev fallback shared with Vite's path-specific proxy target.
 */
import { env } from '$env/dynamic/private';

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
