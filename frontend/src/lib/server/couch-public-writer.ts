import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { adminRaw } from '$lib/server/couch-admin';
import { basicAuthHeader, couchUserFromUrl, parseCouchCredentialUrl } from './couch-credentials';

/**
 * CouchDB username the public writer authenticates as, or `null` when
 * `COUCHDB_PUBLIC_WRITER_URL` is unset/malformed.
 *
 * Provisioning uses this to grant the writer `_security.members` access on each
 * shelter database — it is a plain member, so its writes still go through
 * `_design/access` `validate_doc_update` (unlike admin writes, which bypass it).
 */
export function publicWriterName(): string | null {
	return couchUserFromUrl(env.COUCHDB_PUBLIC_WRITER_URL);
}

/**
 * PUT a document using the dedicated limited-permission public writer user
 * (`COUCHDB_PUBLIC_WRITER_URL`) so public `/api/public/v1/*` writes never use the
 * admin credentials. Falls back to `adminRaw` only in dev when the writer isn't
 * configured yet; in production a missing/invalid writer URL throws (fail-closed).
 *
 * Returns `{ status, data }` shaped like {@link adminRaw}. Used by the public
 * donation PATCH (courier update) and the public booking POST (T-71 / CR-070).
 */
export async function putAsPublicWriter(
	dbName: string,
	docId: string,
	doc: unknown
): Promise<{ status: number; data: unknown }> {
	const writerUrl = env.COUCHDB_PUBLIC_WRITER_URL;

	if (writerUrl) {
		const creds = parseCouchCredentialUrl(writerUrl);
		if (!creds) {
			throw new Error('Invalid COUCHDB_PUBLIC_WRITER_URL format');
		}
		const res = await fetch(`${creds.base}/${dbName}/${encodeURIComponent(docId)}`, {
			method: 'PUT',
			headers: {
				Authorization: basicAuthHeader(creds.user, creds.password),
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

/**
 * Write several documents in one `_bulk_docs` request as the public writer.
 *
 * A booking is a `household` plus one `evacuee` per member; they cross-reference
 * each other (`head_evacuee_id` ↔ `household_id`), and IDs are minted client-side
 * as ULIDs, so the whole set can be linked up before the write and land in a
 * single round trip. CouchDB `_bulk_docs` is not a transaction — it reports
 * per-row success — so the caller must check `failed` and compensate.
 *
 * Returns the rows CouchDB rejected; empty means every document was written.
 */
export async function bulkAsPublicWriter(
	dbName: string,
	docs: { _id: string }[]
): Promise<{ status: number; failed: { id: string; reason: string }[] }> {
	const body = { docs, new_edits: true };
	const path = `/${dbName}/_bulk_docs`;

	const writerUrl = env.COUCHDB_PUBLIC_WRITER_URL;
	let status: number;
	let data: unknown;

	if (writerUrl) {
		const creds = parseCouchCredentialUrl(writerUrl);
		if (!creds) {
			throw new Error('Invalid COUCHDB_PUBLIC_WRITER_URL format');
		}
		const res = await fetch(`${creds.base}${path}`, {
			method: 'POST',
			headers: {
				Authorization: basicAuthHeader(creds.user, creds.password),
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(body)
		});
		status = res.status;
		data = await res.json().catch(() => null);
	} else {
		if (!dev) {
			throw new Error('COUCHDB_PUBLIC_WRITER_URL is missing in production');
		}
		// Dev fallback only — mirrors putAsPublicWriter.
		const res = await adminRaw(path, 'POST', body);
		status = res.status;
		data = res.data;
	}

	if (status >= 400) {
		return { status, failed: docs.map((d) => ({ id: d._id, reason: `HTTP ${status}` })) };
	}

	const rows = Array.isArray(data) ? (data as { id?: string; ok?: boolean; error?: string }[]) : [];
	const failed = rows
		.filter((r) => !r.ok)
		.map((r) => ({ id: r.id ?? '(unknown)', reason: r.error ?? 'unknown' }));

	return { status, failed };
}
