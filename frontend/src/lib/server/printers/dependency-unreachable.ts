const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ENOTFOUND',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_BODY_TIMEOUT',
	'UND_ERR_SOCKET'
]);

const MAX_CAUSE_DEPTH = 4;

/**
 * `fetch` could not reach CouchDB (down, refused, DNS, timeout). Node's `fetch` throws a bare
 * `TypeError('fetch failed')` with the socket error in `cause`; routes map it to the same 503
 * `DEPENDENCY_UNAVAILABLE` envelope as a CouchDB 5xx (FR-25, FR-27).
 */
export function isDependencyUnreachable(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === 'string' && UNREACHABLE_CODES.has(code)) return true;
		if (current.name === 'TimeoutError') return true;
		if (current instanceof TypeError && current.message === 'fetch failed') return true;
		current = current.cause;
	}
	return false;
}
