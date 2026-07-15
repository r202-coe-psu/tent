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
