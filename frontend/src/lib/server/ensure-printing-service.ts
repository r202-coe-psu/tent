/**
 * Idempotent provisioning of the CouchDB `printing_service` user used by
 * `printingRaw` (Pi endpoints, housekeeping, printer-device management).
 *
 * Same shape as `ensure-public-writer.ts`; free of `$env` and `@sveltejs/kit` so
 * maintenance scripts under `frontend/scripts/` can share it with server modules.
 *
 * Only the `_users` doc is created here. Making the user DB-admin of the
 * printing databases is a `_security` concern handled where those DBs are created.
 */

import { parseCouchCredentialUrl } from './couch-credentials';
import type { CouchReq } from './ensure-public-writer';

export const PRINTING_SERVICE_USER_DOC_PREFIX = 'org.couchdb.user:';

export type EnsurePrintingServiceOutcome =
	'skipped' | 'invalid_format' | 'created' | 'already_exists' | 'would_create';

export interface EnsurePrintingServiceResult {
	outcome: EnsurePrintingServiceOutcome;
	username?: string;
}

export function printingServiceUserPath(username: string): string {
	return `/_users/${PRINTING_SERVICE_USER_DOC_PREFIX}${encodeURIComponent(username)}`;
}

export function buildPrintingServiceUserBody(user: string, password: string) {
	return {
		name: user,
		password,
		display_name: 'Printing Service (BFF)',
		roles: [] as string[],
		type: 'user' as const,
		shelter_id: null,
		affiliation_tags: [] as string[]
	};
}

/**
 * Ensure the roleless printing service user exists in `_users`.
 *
 * - Missing `serviceUrl` → `skipped` (dev may fall back to admin).
 * - Malformed `serviceUrl` (e.g. empty password) → `invalid_format`.
 * - `dryRun: true` → GET only; `would_create` or `already_exists`.
 * - Write mode → PUT; `created` (201) or `already_exists` (409).
 */
export async function ensurePrintingService(
	couchReq: CouchReq,
	serviceUrl: string | undefined | null,
	options?: { dryRun?: boolean }
): Promise<EnsurePrintingServiceResult> {
	if (!serviceUrl) {
		return { outcome: 'skipped' };
	}
	const creds = parseCouchCredentialUrl(serviceUrl);
	if (!creds) {
		return { outcome: 'invalid_format' };
	}

	const path = printingServiceUserPath(creds.user);

	if (options?.dryRun) {
		const existing = await couchReq('GET', path);
		return {
			outcome: existing.status === 200 ? 'already_exists' : 'would_create',
			username: creds.user
		};
	}

	const { status } = await couchReq(
		'PUT',
		path,
		buildPrintingServiceUserBody(creds.user, creds.password)
	);
	if (status !== 201 && status !== 409) {
		throw new Error(`PUT _users/${creds.user} failed (HTTP ${status})`);
	}

	return {
		outcome: status === 201 ? 'created' : 'already_exists',
		username: creds.user
	};
}
