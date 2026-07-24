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
