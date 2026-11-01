import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { adminRaw } from '$lib/server/couch-admin';
import { PrintDependencyError } from '$lib/server/printers/device-credentials';
import { basicAuthHeader, couchUserFromUrl, parseCouchCredentialUrl } from './couch-credentials';

/**
 * Server-only CouchDB client for the dedicated `printing_service` user
 * (`COUCHDB_PRINTING_SERVICE_URL`, e.g. `http://printing_service:<pw>@couchdb:5984`).
 *
 * The user has no roles and is DB-admin of the printing databases only, so Pi
 * endpoints, housekeeping and printer-device management never hold the CouchDB
 * server admin (FR-2a, least privilege). Mirrors the `public_writer` pattern.
 */

let warnedDevFallback = false;

/** CouchDB username of the printing service, or `null` when the env var is unset/malformed. */
export function printingServiceName(): string | null {
	return couchUserFromUrl(env.COUCHDB_PRINTING_SERVICE_URL);
}

/**
 * Raw request as `printing_service` — returns status + parsed body (`null` for a
 * non-JSON body), never throws on HTTP error. Same contract as `adminRaw`.
 *
 * Missing env var: in dev falls back to `adminRaw` (with a one-time warning);
 * outside dev it throws {@link PrintDependencyError} (503) — fail closed, never admin.
 * A malformed value fails closed in every environment.
 */
export async function printingRaw(
	path: string,
	method: string,
	body?: unknown,
	signal?: AbortSignal
): Promise<{ status: number; data: unknown }> {
	const raw = env.COUCHDB_PRINTING_SERVICE_URL;

	if (!raw) {
		if (!dev) throw new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is missing');
		if (!warnedDevFallback) {
			warnedDevFallback = true;
			console.warn(
				'[printing] COUCHDB_PRINTING_SERVICE_URL is unset — falling back to the CouchDB admin (dev only)'
			);
		}
		return adminRaw(path, method, body, signal);
	}

	const creds = parseCouchCredentialUrl(raw);
	if (!creds) throw new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is invalid');

	const res = await fetch(`${creds.base}${path}`, {
		method,
		...(signal ? { signal } : {}),
		headers: {
			Authorization: basicAuthHeader(creds.user, creds.password),
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}
