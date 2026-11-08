import { ServiceError, centralCouchBase } from './couch-admin';

/**
 * Server-only CouchDB client that acts as the *caller*, not as an admin.
 *
 * It forwards the caller's `AuthSession` cookie (and nothing else) to central
 * CouchDB, so `_security` and `validate_doc_update` apply to the staff member's
 * own identity (FR-2a, least privilege). No admin credentials are ever attached.
 */

/**
 * A 401/403 from CouchDB for the caller's own session. `couchReason` is for
 * server logs only: it is deliberately NOT in `message` / `description`, which
 * `serviceError()` renders to the client.
 */
export class CouchUserError extends ServiceError {
	constructor(
		code: 'UNAUTHENTICATED' | 'FORBIDDEN',
		message: string,
		readonly couchReason?: string
	) {
		super(code, message);
		this.name = 'CouchUserError';
	}
}

/** The `AuthSession` value from a `Cookie` header, or `null` when absent/empty. */
function authSessionOf(cookieHeader: string | null): string | null {
	for (const part of (cookieHeader ?? '').split(';')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== 'AuthSession') continue;
		const value = part.slice(eq + 1).trim();
		return value || null;
	}
	return null;
}

/**
 * Request CouchDB as the caller. Returns `{ status, data }` like `adminRaw`
 * (`data` is `null` for a non-JSON body). Throws {@link CouchUserError}
 * `UNAUTHENTICATED` (no `AuthSession`, before any fetch, or CouchDB 401) or
 * `FORBIDDEN` (CouchDB 403 from `_security` or `validate_doc_update`); every
 * other status is returned for the caller to interpret.
 */
export async function userRaw(
	cookieHeader: string | null,
	path: string,
	method: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const session = authSessionOf(cookieHeader);
	if (!session) throw new CouchUserError('UNAUTHENTICATED', 'Authentication required');

	const res = await fetch(`${centralCouchBase()}${path}`, {
		method,
		headers: {
			Cookie: `AuthSession=${session}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json().catch(() => null);

	if (res.status === 401 || res.status === 403) {
		const reason = (data as { reason?: unknown } | null)?.reason;
		throw new CouchUserError(
			res.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
			res.status === 401 ? 'Authentication required' : 'Not permitted',
			typeof reason === 'string' ? reason : undefined
		);
	}
	return { status: res.status, data };
}
