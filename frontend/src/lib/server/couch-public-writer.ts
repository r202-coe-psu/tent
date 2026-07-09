import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { adminRaw } from '$lib/server/couch-admin';

/**
 * PUT a document using the dedicated limited-permission public writer user
 * (`COUCHDB_PUBLIC_WRITER_URL`) so public `/api/public/v1/*` writes never use the
 * admin credentials. Falls back to `adminRaw` only in dev when the writer isn't
 * configured yet; in production a missing/invalid writer URL throws (fail-closed).
 *
 * Returns `{ status, data }` shaped like {@link adminRaw}. Shared by the public
 * donation POST (create) and PATCH (courier update) handlers.
 */
export async function putAsPublicWriter(
	dbName: string,
	docId: string,
	doc: unknown
): Promise<{ status: number; data: unknown }> {
	const writerUrl = env.COUCHDB_PUBLIC_WRITER_URL;

	if (writerUrl) {
		const match = writerUrl.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
		if (!match) {
			throw new Error('Invalid COUCHDB_PUBLIC_WRITER_URL format');
		}
		const [, scheme, user, pass, host] = match;
		const base = `${scheme}${host}`.replace(/\/$/, '');
		const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
		const res = await fetch(`${base}/${dbName}/${encodeURIComponent(docId)}`, {
			method: 'PUT',
			headers: {
				Authorization: authHeader,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(doc)
		});
		return { status: res.status, data: await res.json().catch(() => null) };
	}

	if (!dev) {
		throw new Error('COUCHDB_PUBLIC_WRITER_URL is missing in production');
	}
	// Dev fallback only — enforce real writes via validate_doc_update once T-02 lands.
	return adminRaw(`/${dbName}/${encodeURIComponent(docId)}`, 'PUT', doc);
}
