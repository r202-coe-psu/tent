/**
 * Maps a failed public search/list response to a coarse kind the UI can translate.
 * Backend wire shapes (never shown to users verbatim):
 * - FastAPI: `{ errors: [{ error: { code, message } }] }` (422 VALIDATION, 429 RATE_LIMITED)
 * - BFF:     `{ error: { code, message } }` (503 SEARCH_UNAVAILABLE, 400 INVALID_BODY)
 */

export type PublicApiErrorKind = 'validation' | 'rateLimited' | 'unavailable' | 'generic';

function errorCode(body: unknown): string | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as {
		error?: { code?: unknown } | unknown;
		errors?: Array<{ error?: { code?: unknown } } | unknown>;
	};
	const top = b.error;
	if (top && typeof top === 'object' && typeof (top as { code?: unknown }).code === 'string') {
		return (top as { code: string }).code;
	}
	const nested = Array.isArray(b.errors) ? b.errors[0] : null;
	if (nested && typeof nested === 'object') {
		const inner = (nested as { error?: { code?: unknown } }).error;
		if (inner && typeof inner.code === 'string') return inner.code;
	}
	return null;
}

export function classifyPublicApiError(body: unknown, status: number): PublicApiErrorKind {
	const code = errorCode(body);
	if (code === 'VALIDATION' || status === 422) return 'validation';
	if (code === 'RATE_LIMITED' || status === 429) return 'rateLimited';
	if (code === 'SEARCH_UNAVAILABLE' || status === 503) return 'unavailable';
	return 'generic';
}
