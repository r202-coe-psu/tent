/**
 * Server-side helpers for the shelters feature.
 *
 * All shelter master documents live in the `registry` database. These helpers
 * centralise the read/migrate/now-iso plumbing so the +server.ts handlers stay
 * thin (and the skill rule "no duplicated read-modify-write loops" is met).
 *
 * IMPORTANT: this file is server-only. It uses `adminRaw` from couch-admin
 * (which embeds the CouchDB admin credentials) and must never be imported from
 * a client bundle. SvelteKit enforces this by convention — anything in
 * `$lib/server/` is excluded from the client build.
 */

import { adminRaw, ServiceError } from './couch-admin';
import { migrateShelterV2ToCurrent, type ShelterMaster, type ShelterMasterV2 } from '$lib/features/shelters/domain/schema';

export const SHELTER_REGISTRY_DB = 'registry';

/** ISO 8601 UTC timestamp (server clock). */
export function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Read every shelter master doc from the registry. Returns an empty list when
 * the registry db has not been created yet (404) — that is the legitimate
 * "no shelters" state on a fresh install. Any other 4xx/5xx bubbles up.
 */
export async function listShelterMasters(): Promise<ShelterMaster[]> {
	const res = await adminRaw(`/${SHELTER_REGISTRY_DB}/_all_docs?include_docs=true`, 'GET');
	if (res.status === 404) return [];
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not read registry');
	const rows = (res.data as { rows?: { id: string; doc: ShelterMaster }[] })?.rows ?? [];
	return rows.filter((r) => r.id.startsWith('shelter:') && r.doc).map((r) => r.doc);
}

/**
 * Find a shelter master by its `code` field (e.g. SH001). Performs a
 * full-doc scan over the registry — fine at current scale; a `_view/by_code`
 * can be added later if the registry grows.
 */
export async function findMasterByCode(code: string): Promise<ShelterMaster | null> {
	const res = await adminRaw(`/${SHELTER_REGISTRY_DB}/_all_docs?include_docs=true`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not read registry');
	const rows = (res.data as { rows?: { id: string; doc: unknown }[] })?.rows ?? [];
	const match = rows.find(
		(r) => r.id.startsWith('shelter:') && r.doc && (r.doc as { code?: string }).code === code
	);
	return (match?.doc as ShelterMaster) ?? null;
}

/** Idempotent v2 → v3 migration wrapper. */
export function migrate(master: ShelterMasterV2 | ShelterMaster): ShelterMaster {
	if (master.schema_v >= 3) return master as ShelterMaster;
	return migrateShelterV2ToCurrent(master);
}

/**
 * Read-modify-write helper for the shelter registry.
 *
 * Fetches the current master doc, applies the mutator, and writes the result.
 * On 409 Conflict, retries up to 3 times — this is the canonical CouchDB MVCC
 * dance (skill: couchdb-pouchdb-bestpractices §3). Each retry refetches the
 * latest _rev, so concurrent writers cannot silently overwrite each other.
 *
 * The mutator receives the freshly-migrated v3 doc and must return the next
 * full doc body (the function will spread `_id` and `_rev` from the latest
 * read automatically).
 */
export async function updateMaster<T = void>(
	code: string,
	mutator: (
		current: ShelterMaster
	) =>
		| { patch: Partial<ShelterMaster>; meta?: T }
		| Promise<{ patch: Partial<ShelterMaster>; meta?: T }>
): Promise<{ id: string; rev: string; meta?: T }> {
	const MAX_RETRIES = 3;
	let lastStatus = 0;
	let lastReason: string | null = null;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		const current = await findMasterByCode(code);
		if (!current) {
			throw new ServiceError('VALIDATION', `Shelter "${code}" not found`);
		}
		const migrated = migrate(current);
		const next = await mutator(migrated);
		const body: ShelterMaster = {
			...migrated,
			...next.patch,
			_id: current._id,
			_rev: current._rev
		};
		const res = await adminRaw(
			`/${SHELTER_REGISTRY_DB}/${encodeURIComponent(current._id)}`,
			'PUT',
			body
		);
		if (res.status === 409) {
			lastStatus = 409;
			lastReason =
				(res.data as { reason?: string } | null)?.reason ?? 'concurrent update — retrying';
			continue;
		}
		if (res.status >= 400) {
			const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
			throw new ServiceError(
				'INTERNAL',
				`Registry write failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
		const data = res.data as { _id: string; _rev: string };
		return { id: data._id, rev: data._rev, meta: next.meta };
	}

	throw new ServiceError(
		'CONFLICT',
		`Could not update shelter "${code}" after ${MAX_RETRIES} attempts: ${lastReason ?? lastStatus}`
	);
}

/**
 * Read-modify-write helper for the shelter `_security` document.
 *
 * Blind-overwriting `_security` would wipe out any members or roles added since
 * provisioning (skill: couchdb-pouchdb-bestpractices §4). This helper merges the
 * incoming members/roles with whatever is currently there, taking the union
 * (a user/role that already has access keeps it; new ones are appended).
 */
export async function mergeShelterSecurity(
	db: string,
	addAdmins: { names?: string[]; roles?: string[] } = {},
	addMembers: { names?: string[]; roles?: string[] } = {}
): Promise<void> {
	const current = await adminRaw(`/${db}/_security`, 'GET');
	const existing =
		(current.data as { admins?: { names?: string[]; roles?: string[] }; members?: { names?: string[]; roles?: string[] } } | null) ??
		{};

	const merged = {
		admins: {
			names: uniq([...(existing.admins?.names ?? []), ...(addAdmins.names ?? [])]),
			roles: uniq([...(existing.admins?.roles ?? []), ...(addAdmins.roles ?? [])])
		},
		members: {
			names: uniq([...(existing.members?.names ?? []), ...(addMembers.names ?? [])]),
			roles: uniq([...(existing.members?.roles ?? []), ...(addMembers.roles ?? [])])
		}
	};

	const put = await adminRaw(`/${db}/_security`, 'PUT', merged);
	if (put.status >= 400) {
		const detail = (put.data as { reason?: string; error?: string } | null) ?? {};
		throw new ServiceError(
			'INTERNAL',
			`_security write failed (${put.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
}

function uniq<T>(arr: T[]): T[] {
	return [...new Set(arr)];
}
