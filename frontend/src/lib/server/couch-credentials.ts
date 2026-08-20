/**
 * Pure parsing helpers for CouchDB credential URLs (`http://user:pass@host:port`).
 *
 * Deliberately free of `$env`, `$app/*` and `@sveltejs/kit` so the maintenance
 * scripts under `frontend/scripts/` — which run under plain `tsx` without the
 * SvelteKit runtime — can share it with the server modules. Keep it that way.
 */

export interface CouchCredentials {
	/** Origin without credentials and without a trailing slash (`http://localhost:5984`). */
	base: string;
	user: string;
	password: string;
}

/** `scheme://user:password@host[:port][/path]` — user may not contain `:`, `/` or `@`. */
const CREDENTIAL_URL = /^(https?:\/\/)([^:/@]+):([^@]+)@(.+)$/;

/** Parse a credential URL, or `null` when it is absent or malformed. */
export function parseCouchCredentialUrl(raw: string | undefined | null): CouchCredentials | null {
	if (!raw) return null;
	const match = raw.match(CREDENTIAL_URL);
	if (!match) return null;
	const [, scheme, user, password, host] = match;
	return {
		base: `${scheme}${host}`.replace(/\/$/, ''),
		user: decodeURIComponent(user),
		password: decodeURIComponent(password)
	};
}

/** Just the username — used to grant the writer `_security.members` access. */
export function couchUserFromUrl(raw: string | undefined | null): string | null {
	return parseCouchCredentialUrl(raw)?.user ?? null;
}

/** `Authorization` header value for the given CouchDB credentials. */
export function basicAuthHeader(user: string, password: string): string {
	return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}
