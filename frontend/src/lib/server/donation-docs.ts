import { adminRaw } from '$lib/server/couch-admin';

/**
 * Fetch all docs of a given type (by `_id` prefix) from a shelter database via
 * `_all_docs` (no view required — matches project convention).
 *
 * **Server-only** (uses admin credentials). Kept out of `features/donations/domain`
 * so the client barrel stays free of server imports (domain must be pure — no I/O).
 * Shared by `POST /api/public/v1/donations` and `GET /api/public/v1/needs`.
 */
export async function fetchDocs<T>(dbName: string, prefix: string): Promise<T[]> {
	const res = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}￰"`,
		'GET'
	);
	if (res.status >= 400) return [];
	const rows = (res.data as { rows?: { doc: T }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter(Boolean);
}

/** A CouchDB read that failed for a reason other than "database does not exist". */
export class CouchReadError extends Error {
	readonly status: number;
	constructor(dbName: string, prefix: string, status: number) {
		super(`CouchDB read failed (${status}) for ${dbName}/${prefix}`);
		this.name = 'CouchReadError';
		this.status = status;
	}
}

/**
 * Fail-closed variant of {@link fetchDocs} for reads that gate a decision (e.g. how many
 * bookings a window already holds). A missing database (404) really is "no docs yet" and
 * returns `[]`; any other error status throws {@link CouchReadError} so the caller can
 * refuse instead of treating an outage as "nothing booked".
 */
export async function fetchDocsStrict<T>(dbName: string, prefix: string): Promise<T[]> {
	const res = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}￰"`,
		'GET'
	);
	if (res.status === 404) return [];
	if (res.status >= 400) throw new CouchReadError(dbName, prefix, res.status);
	const rows = (res.data as { rows?: { doc: T }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter(Boolean);
}
