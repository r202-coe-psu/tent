/**
 * Idempotent provisioning of the CouchDB `public_writer` user used by
 * `putAsPublicWriter` / `bulkAsPublicWriter`.
 *
 * Deliberately free of `$env` and `@sveltejs/kit` so maintenance scripts under
 * `frontend/scripts/` can share it with server modules.
 */

import { parseCouchCredentialUrl } from './couch-credentials';

export const PUBLIC_WRITER_USER_DOC_PREFIX = 'org.couchdb.user:';

export type CouchReq = (
	method: string,
	path: string,
	body?: unknown
) => Promise<{ status: number; data: unknown }>;

export type EnsurePublicWriterOutcome =
	| 'skipped'
	| 'created'
	| 'already_exists'
	| 'would_create';

export interface EnsurePublicWriterResult {
	outcome: EnsurePublicWriterOutcome;
	username?: string;
}

export function publicWriterUserPath(username: string): string {
	return `/_users/${PUBLIC_WRITER_USER_DOC_PREFIX}${encodeURIComponent(username)}`;
}

export function buildPublicWriterUserBody(user: string, password: string) {
	return {
		name: user,
		password,
		display_name: 'Public Writer (BFF)',
		roles: [] as string[],
		type: 'user' as const,
		shelter_id: null,
		affiliation_tags: [] as string[]
	};
}

/**
 * Ensure the roleless public writer exists in `_users`.
 *
 * - Missing/malformed `writerUrl` → `skipped` (dev may fall back to admin).
 * - `dryRun: true` → GET only; `would_create` or `already_exists`.
 * - Write mode → PUT; `created` (201) or `already_exists` (409).
 */
export async function ensurePublicWriter(
	couchReq: CouchReq,
	writerUrl: string | undefined | null,
	options?: { dryRun?: boolean }
): Promise<EnsurePublicWriterResult> {
	const creds = parseCouchCredentialUrl(writerUrl);
	if (!creds) {
		return { outcome: 'skipped' };
	}

	const path = publicWriterUserPath(creds.user);

	if (options?.dryRun) {
		const existing = await couchReq('GET', path);
		return {
			outcome: existing.status === 200 ? 'already_exists' : 'would_create',
			username: creds.user
		};
	}

	const { status } = await couchReq('PUT', path, buildPublicWriterUserBody(creds.user, creds.password));
	if (status !== 201 && status !== 409) {
		throw new Error(`PUT _users/${creds.user} failed (HTTP ${status})`);
	}

	return {
		outcome: status === 201 ? 'created' : 'already_exists',
		username: creds.user
	};
}
