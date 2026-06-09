import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';

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
	const data = (await res.json().catch(() => null)) as (T & { error?: string; reason?: string }) | null;
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
	const data = (await res.json().catch(() => null)) as
		| { userCtx?: { name: string | null; roles: string[] } }
		| null;
	const roles = data?.userCtx?.roles ?? [];
	if (!data?.userCtx?.name) throw error(401, 'Authentication required');
	if (!roles.includes('_admin')) throw error(403, 'Admin privileges required');
}
