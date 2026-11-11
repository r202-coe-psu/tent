import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { hasShelterScope, isSystemAdmin, shelterCodeFromRoles } from '$lib/auth/roles';

/**
 * Credential-free session helpers shared by the staff/back-office routes AND the print-server
 * routes. Nothing here holds or sends CouchDB admin credentials: the caller's own cookie is
 * forwarded to central `_session`, and {@link ServiceError} is a plain error type. Printer code
 * (CR-222 FR-2a) imports these instead of `$lib/server/couch-admin`, which stays the only home of
 * the server-admin client. `couch-admin.ts` re-exports everything here for its existing callers.
 */

/**
 * Central CouchDB origin (no credentials, no trailing slash). Derived from `COUCHDB_ADMIN_URL`
 * by keeping scheme + host only — the userinfo part is discarded, never returned or sent.
 */
export function centralCouchBase(): string {
	const match = (env.COUCHDB_ADMIN_URL ?? '').match(/^(https?:\/\/)[^:]+:[^@]+@(.+)$/);
	if (!match) {
		throw error(500, 'COUCHDB_ADMIN_URL is not set or missing credentials');
	}
	return `${match[1]}${match[2]}`.replace(/\/$/, '');
}

export type ServiceErrorCode =
	| 'UNAUTHENTICATED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'VALIDATION'
	| 'CONFLICT'
	| 'INTERNAL'
	/** A store the answer depends on (registry, a shelter DB) could not be read (api-contract §2). */
	| 'DEPENDENCY_UNAVAILABLE';

const STATUS_BY_CODE: Record<ServiceErrorCode, number> = {
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	VALIDATION: 422,
	CONFLICT: 409,
	INTERNAL: 500,
	DEPENDENCY_UNAVAILABLE: 503
};

/** HTTP status for a {@link ServiceErrorCode} — for callers that answer with `fail()` instead of JSON. */
export const serviceErrorStatus = (code: ServiceErrorCode): number => STATUS_BY_CODE[code];

/** Contract-shaped error carrying its code; handlers turn it into the envelope. */
export class ServiceError extends Error {
	constructor(
		readonly code: ServiceErrorCode,
		message: string,
		/** Optional operator-facing detail (CouchDB reason, remediation). Never put secrets here. */
		readonly description?: string
	) {
		super(message);
		this.name = 'ServiceError';
	}
}

/** Authenticated caller, resolved from the session cookie via central `_session`. */
export interface Caller {
	name: string;
	roles: string[];
	/** SA or CouchDB server admin (global authority over users). */
	isSA: boolean;
	/** The caller's single shelter code (`shelter:{code}` → `{code}`), or null. */
	shelterCode: string | null;
}

/**
 * Resolve the caller's identity by forwarding their cookie to central `/_session` (whoami).
 * `name` is null for an anonymous session; `roles` is `[]` when CouchDB returns no userCtx.
 * Never throws on an unauthenticated session — callers decide the error to raise.
 */
export async function readSessionUserCtx(
	cookie: string | null
): Promise<{ name: string | null; roles: string[] }> {
	const res = await fetch(`${centralCouchBase()}/_session`, {
		headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) }
	});
	const data = (await res.json().catch(() => null)) as {
		userCtx?: { name: string | null; roles: string[] };
	} | null;
	return { name: data?.userCtx?.name ?? null, roles: data?.userCtx?.roles ?? [] };
}

/**
 * Read-only gate: SA or any user whose roles include the shelter scope
 * (`shelter:{code}`). Use this for GET endpoints — staff roles
 * (registration_staff / kitchen_staff / warehouse_staff) all need to see their
 * shelter's detail to do their work; writes still require
 * `requireShelterManagerOrSA`.
 *
 * Omit `code` to only resolve the caller's session (returns the {@link Caller}
 * so the handler can scope the response — e.g. SA → all rows, shelter-scoped
 * user → only their own). With `code`, the caller's `shelterCode` must equal
 * that value unless the caller is a system admin.
 *
 * @param cookie  The request's `Cookie` header (may be null for anonymous).
 * @param code    Optional shelter code from the URL params.
 */
export async function requireShelterScopeOrSA(
	cookie: string | null,
	code?: string
): Promise<Caller> {
	const { name, roles } = await readSessionUserCtx(cookie);
	if (!name) throw error(401, 'Authentication required');

	const caller: Caller = {
		name,
		roles,
		isSA: isSystemAdmin(roles),
		shelterCode: shelterCodeFromRoles(roles)
	};
	if (code === undefined) return caller;
	if (caller.isSA) return caller;
	if (hasShelterScope(caller.roles, code)) return caller;
	throw error(403, `Caller is not in shelter "${code}" scope`);
}
