import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import {
	COUCH_ADMIN,
	isShelterManager,
	isStaffOnly,
	isSystemAdmin,
	shelterCodeFromRoles
} from '$lib/auth/roles';

/**
 * Server-only CouchDB admin client.
 *
 * The admin URL (with embedded credentials) lives in COUCHDB_ADMIN_URL, a
 * PRIVATE env var that is never bundled into the browser. All privileged
 * CouchDB calls (create DB, write _security, manage _users, etc.) go through
 * here so the admin password stays on the server.
 */

function adminConfig(): { base: string; authHeader: string } {
	const url = env.COUCHDB_ADMIN_URL ?? '';
	const match = url.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
	if (!match) {
		throw error(500, 'COUCHDB_ADMIN_URL is not set or missing credentials');
	}
	const [, scheme, user, pass, host] = match;
	return {
		base: `${scheme}${host}`.replace(/\/$/, ''),
		authHeader: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
	};
}

/** Raw admin request — returns status + parsed body, never throws on HTTP error. */
export async function adminRaw(
	path: string,
	method: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const { base, authHeader } = adminConfig();
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

/** Admin request that parses JSON and throws CouchDB's reason on HTTP error. */
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const { base, authHeader } = adminConfig();
	const res = await fetch(`${base}${path}`, {
		...init,
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...init.headers
		}
	});
	const data = (await res.json().catch(() => null)) as
		| (T & { error?: string; reason?: string })
		| null;
	if (!res.ok) {
		throw error(res.status, data?.reason ?? data?.error ?? `CouchDB error (${res.status})`);
	}
	return data as T;
}

/**
 * Authorize the caller as a CouchDB server admin.
 *
 * Forwards the caller's AuthSession cookie to CouchDB `_session` and requires
 * the `_admin` role. Throws 401/403 otherwise. This keeps admin endpoints from
 * being usable by anonymous or non-admin authenticated users.
 */
export async function requireAdmin(cookie: string | null): Promise<void> {
	const { base } = adminConfig();
	const res = await fetch(`${base}/_session`, {
		headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) }
	});
	const data = (await res.json().catch(() => null)) as {
		userCtx?: { name: string | null; roles: string[] };
	} | null;
	const roles = data?.userCtx?.roles ?? [];
	if (!data?.userCtx?.name) throw error(401, 'Authentication required');
	if (!roles.includes('_admin')) throw error(403, 'Admin privileges required');
}

// ----------------------------------------------------------- service contract
//
// The /api/v1/* service plane (api-contract.md §2) speaks a stable contract the
// future FastAPI inherits: a `{ error: { code, message } }` envelope and
// session-cookie authorization. These helpers keep the BFF on that contract.

export type ServiceErrorCode =
	| 'UNAUTHENTICATED'
	| 'FORBIDDEN'
	| 'VALIDATION'
	| 'CONFLICT'
	| 'INTERNAL';

const STATUS_BY_CODE: Record<ServiceErrorCode, number> = {
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	VALIDATION: 422,
	CONFLICT: 409,
	INTERNAL: 500
};

/** Contract-shaped error carrying its code; handlers turn it into the envelope. */
export class ServiceError extends Error {
	constructor(
		readonly code: ServiceErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ServiceError';
	}
}

/**
 * Render a caught error as the contract envelope `{ error: { code, message } }`.
 * Unknown errors collapse to a generic INTERNAL — never leak a raw CouchDB
 * reason or the admin URL to the client.
 */
export function serviceError(e: unknown): Response {
	const err =
		e instanceof ServiceError ? e : new ServiceError('INTERNAL', 'Unexpected server error');
	return json(
		{ error: { code: err.code, message: err.message } },
		{ status: STATUS_BY_CODE[err.code] }
	);
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
 * Authorize a user-management write. Forwards the caller's cookie to central
 * `/_session` (whoami), then requires SA or shelter_manager. Returns the caller
 * so the handler can scope the operation. Throws {@link ServiceError}.
 */
export async function authorizeUserWrite(cookie: string | null): Promise<Caller> {
	const { base } = adminConfig();
	const res = await fetch(`${base}/_session`, {
		headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) }
	});
	const data = (await res.json().catch(() => null)) as {
		userCtx?: { name: string | null; roles: string[] };
	} | null;
	const name = data?.userCtx?.name;
	const roles = data?.userCtx?.roles ?? [];
	if (!name) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');

	const isSA = isSystemAdmin(roles);
	if (!isSA && !isShelterManager(roles)) {
		throw new ServiceError('FORBIDDEN', 'Requires system_admin or shelter_manager');
	}
	return { name, roles, isSA, shelterCode: shelterCodeFromRoles(roles) };
}

/**
 * Enforce what a caller may grant a new/edited user (least privilege). The
 * requested `roles[]` is validated against the caller — never trusted:
 *  - SA: any roles except the CouchDB server admin (`_admin`); at most one
 *    shelter scope (1 user 1 shelter).
 *  - shelter_manager: shelter scope MUST equal the caller's own (no cross-shelter),
 *    capabilities ⊆ {volunteer, kitchen_staff, warehouse_staff} (no manager/SA).
 *
 * Throws {@link ServiceError} (FORBIDDEN/VALIDATION) on violation.
 */
export function assertCanGrant(caller: Caller, requestedRoles: readonly string[]): void {
	if (requestedRoles.includes(COUCH_ADMIN)) {
		throw new ServiceError('FORBIDDEN', 'Cannot grant the CouchDB server-admin role');
	}
	const shelterRoles = requestedRoles.filter((r) => r.startsWith('shelter:'));
	if (shelterRoles.length > 1) {
		throw new ServiceError('VALIDATION', 'A user belongs to at most one shelter');
	}

	if (caller.isSA) return; // SA may grant any non-_admin role.

	// shelter_manager: own shelter only, staff capabilities only.
	if (!caller.shelterCode) {
		throw new ServiceError('FORBIDDEN', 'Manager has no shelter scope');
	}
	if (shelterRoles.length !== 1 || shelterRoles[0] !== `shelter:${caller.shelterCode}`) {
		throw new ServiceError('FORBIDDEN', 'A manager may only add users to their own shelter');
	}
	if (!isStaffOnly(requestedRoles)) {
		throw new ServiceError(
			'FORBIDDEN',
			'A manager may only grant volunteer/kitchen_staff/warehouse_staff'
		);
	}
}
