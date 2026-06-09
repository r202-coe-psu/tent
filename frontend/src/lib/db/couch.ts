import { PUBLIC_COUCHDB_URL, PUBLIC_COUCH_PROXY } from '$env/static/public';

/**
 * Base URL for all cookie-authenticated CouchDB requests.
 *
 * When PUBLIC_COUCH_PROXY is set (e.g. "/couch"), the Vite dev-server proxy
 * routes requests through the same origin, so the AuthSession cookie is
 * treated as first-party and sent correctly by the browser.
 *
 * When empty (production / tests), falls back to PUBLIC_COUCHDB_URL — which
 * carries NO credentials; a reverse-proxy (nginx etc.) must then handle CORS
 * and cookie forwarding. Admin credentials live only in COUCHDB_ADMIN_URL
 * (server-side, see $lib/server/couch-admin).
 */
export const COUCH_URL = PUBLIC_COUCH_PROXY || PUBLIC_COUCHDB_URL;

/** CouchDB user context, as returned by `GET /_session`. */
export interface SessionUser {
	name: string;
	roles: string[];
}

interface SessionResponse {
	ok: boolean;
	userCtx: { name: string | null; roles: string[] };
}

/** Thin fetch wrapper: sends cookies, parses JSON, throws CouchDB's reason on error. */
export async function couchFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${COUCH_URL}${path}`, {
		credentials: 'include',
		...init,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...init.headers
		}
	});

	const data = (await res.json().catch(() => null)) as
		| (T & { error?: string; reason?: string })
		| null;

	if (!res.ok) {
		const message = data?.reason || data?.error || `CouchDB request failed (${res.status})`;
		throw new Error(message);
	}

	return data as T;
}

/** Authenticate against `_users`; CouchDB sets the AuthSession cookie on success. */
export async function sessionLogin(input: { name: string; password: string }): Promise<SessionUser> {
	const res = await couchFetch<{ ok: boolean; name: string; roles: string[] }>('/_session', {
		method: 'POST',
		body: JSON.stringify(input)
	});
	return { name: res.name, roles: res.roles };
}

/** Clear the AuthSession cookie. */
export async function sessionLogout(): Promise<void> {
	await couchFetch('/_session', { method: 'DELETE' });
}

/** Current user from the session cookie, or null when anonymous. */
export async function getSession(): Promise<SessionUser | null> {
	const res = await couchFetch<SessionResponse>('/_session');
	if (!res.userCtx?.name) return null;
	return { name: res.userCtx.name, roles: res.userCtx.roles };
}
