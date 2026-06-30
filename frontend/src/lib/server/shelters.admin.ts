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
import {
	migrateShelterV2ToCurrent,
	type ShelterMaster,
	type ShelterMasterV2
} from '$lib/features/shelters/server';

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
 * Find a shelter master by its `code` field (e.g. SH001). Scans the full
 * registry — the `_id` uses a ULID (`shelter:{ulid()}`), not the code, so
 * direct lookup is not possible without a `_view/by_code`.
 * TODO: switch to `shelter:{code}` as the canonical `_id` and drop this scan.
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
		const data = res.data as { id: string; rev: string };
		return { id: data.id, rev: data.rev, meta: next.meta };
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
		(current.data as {
			admins?: { names?: string[]; roles?: string[] };
			members?: { names?: string[]; roles?: string[] };
		} | null) ?? {};

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

/**
 * Deploy CouchDB Design Documents (Views) for a shelter database.
 *
 * CR-020 (T-52): Adds 4 MapReduce views under the single `_design/app` design
 * document (couchdb-pouchdb-bestpractices §6 — one design doc per db).
 *
 * Views deployed:
 *   - `occupancy`               — count by `current_stay.status` (total / checked_in / checked_out)
 *   - `demographics_by_age`     — count by age-bucket string, derived from `birth_year` (พ.ศ.)
 *   - `demographics_by_country`     — count by `country` field (req); falls back to 'unknown'
 *   - `registrations_by_date`   — count evacuee docs by `created_at` date (YYYY-MM-DD)
 *
 * All views use `?group=true` for per-key breakdown (see CONVENTIONS.md §5).
 * Views are idempotent: if `_design/app` already exists the current `_rev` is
 * fetched first and sent on the PUT (Read-Modify-Write; skill §3).
 */
export async function deployShelterViews(db: string): Promise<number> {
	// ── occupancy ────────────────────────────────────────────────────────────
	// Emits current_stay.status as the key so callers get per-status counts
	// with `?group=true`. Schema: evacuee.current_stay.status ∈
	// { registered, checked_in, checked_out, transferred } (schema.md §1.1).
	const occupancyMap = `function(doc) {
  if (doc.type !== 'evacuee' || !doc.current_stay) return;
  emit(doc.current_stay.status, 1);
}`;

	// ── demographics_by_age ──────────────────────────────────────────────────
	// birth_year is stored as a Thai Buddhist Era (พ.ศ.) 4-digit integer.
	// Convert to approximate age: CE_year = พ.ศ. − 543; age = currentYear − CE_year.
	// Bucket labels mirror CR-020 §3 (age groups).
	// Evacuees with no birth_year emit 'unknown'.
	const demographicsByAgeMap = `function(doc) {
  if (doc.type !== 'evacuee') return;
  if (!doc.birth_year) { emit('unknown', 1); return; }
  var ceYear = doc.birth_year - 543;
  var currentYear = new Date().getFullYear();
  var age = currentYear - ceYear;
  var bucket;
  if      (age <= 4)  bucket = '0-4';
  else if (age <= 11) bucket = '5-11';
  else if (age <= 17) bucket = '12-17';
  else if (age <= 59) bucket = '18-59';
  else                bucket = '60+';
  emit(bucket, 1);
}`;

	// ── demographics_by_country ──────────────────────────────────────────────
	// Uses the `country` req field on evacuee (enum mapped to THAILAND default).
	// Falls back to 'unknown' when absent or blank (for backwards compat).
	// CR-020 §3 calls this "สัญชาติ/ประเทศ" (updated via CR-007).
	const demographicsByCountryMap = `function(doc) {
  if (doc.type !== 'evacuee') return;
  var c = (doc.country || '').trim().toUpperCase() || 'UNKNOWN';
  emit(c, 1);
}`;

	// ── registrations_by_date ────────────────────────────────────────────────
	// Emits the date portion of created_at (YYYY-MM-DD) as the key.
	// Query with ?group=true to get daily registration counts.
	// Use ?startkey="YYYY-MM-DD"&endkey="YYYY-MM-DD￰" for date ranges.
	const registrationsByDateMap = `function(doc) {
  if (doc.type !== 'evacuee' || !doc.created_at) return;
  var date = doc.created_at.slice(0, 10);
  emit(date, 1);
}`;

	const appDesign: { _id: string; _rev?: string; views: Record<string, { map: string; reduce: string }> } = {
		_id: '_design/app',
		views: {
			occupancy: {
				map: occupancyMap,
				reduce: '_count'
			},
			demographics_by_age: {
				map: demographicsByAgeMap,
				reduce: '_count'
			},
			demographics_by_country: {
				map: demographicsByCountryMap,
				reduce: '_count'
			},
			registrations_by_date: {
				map: registrationsByDateMap,
				reduce: '_count'
			}
		}
	};

	// Read-Modify-Write: fetch existing _rev to avoid 409 Conflict (skill §3).
	const existing = await adminRaw(`/${db}/_design/app`, 'GET');
	if (existing.status === 200) {
		appDesign['_rev'] = (existing.data as { _rev: string })._rev;
	}

	const res = await adminRaw(`/${db}/_design/app`, 'PUT', appDesign);
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new ServiceError(
			'INTERNAL',
			`Failed to deploy _design/app to ${db} (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return res.status;
}
