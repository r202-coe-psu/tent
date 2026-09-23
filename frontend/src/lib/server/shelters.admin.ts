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

import { randomUUID } from 'node:crypto';
import { adminRaw, ServiceError } from './couch-admin';
import { buildSecurityMutationLock, type SecurityMutationLock } from './security-mutation-lock';
import {
	buildValidateDocUpdate,
	REFERRAL_MANGO_INDEXES,
	TRANSFER_LEDGER_MANGO_INDEXES
} from './shelter-access-design';
import {
	buildRegistryDesignDoc,
	buildRegistryValidateDocUpdate,
	REGISTRY_DESIGN_ID,
	registryByCodePath,
	registryHighestByCodePath,
	registryByNamePath
} from './registry-design';
import {
	migrateShelterV2ToCurrent,
	type ShelterMaster,
	type ShelterMasterV2
} from '$lib/features/shelters/server';
import { deployShelterViewsFn } from '$lib/features/shelters/server/deploy';

export { REFERRAL_MANGO_INDEXES, TRANSFER_LEDGER_MANGO_INDEXES } from './shelter-access-design';

export interface ViewResult {
	rows: { key: string; value: number }[];
}

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
 * Find a shelter master by its `code` field (e.g. SH001).
 *
 * The `_id` is `shelter:{ulid}`, not the code, so this goes through
 * `_design/app/_view/by_code` (see `registry-design.ts`). Falls back to a full
 * scan only when the design doc is missing — a registry provisioned before the
 * view existed and not yet run through `pnpm redeploy:access`.
 */
export async function findMasterByCode(code: string): Promise<ShelterMaster | null> {
	const res = await adminRaw(registryByCodePath(code), 'GET');
	if (res.status === 200) {
		const rows = (res.data as { rows?: { doc?: unknown }[] })?.rows ?? [];
		return (rows[0]?.doc as ShelterMaster) ?? null;
	}
	if (res.status === 404) {
		// Missing database vs missing design doc: fail closed if the design doc is missing
		const reason = (res.data as { reason?: string } | null)?.reason ?? '';
		if (reason === 'Database does not exist.') return null;
		throw new ServiceError('INTERNAL', 'Registry code index is not available');
	}
	throw new ServiceError('INTERNAL', 'Could not read registry');
}

/**
 * Find a shelter master by normalized name through the registry view. The
 * import worker uses this keyed lookup instead of scanning every master for
 * each item in a batch.
 */
export async function findMasterByName(name: string): Promise<ShelterMaster | null> {
	const res = await adminRaw(registryByNamePath(name), 'GET');
	if (res.status === 200) {
		const rows = (res.data as { rows?: { doc?: unknown }[] })?.rows ?? [];
		return (rows[0]?.doc as ShelterMaster) ?? null;
	}
	if (res.status === 404) {
		const reason = (res.data as { reason?: string } | null)?.reason ?? '';
		if (reason === 'Database does not exist.') return null;
		throw new ServiceError('INTERNAL', 'Registry shelter name index is not available');
	}
	throw new ServiceError('INTERNAL', 'Could not read registry by shelter name');
}

/**
 * Read the highest numeric shelter-code suffix from the registry view. This is
 * used only to initialize the allocator and avoids an O(registry) scan on the
 * provisioning request path.
 */
export async function findHighestShelterCodeNumber(): Promise<number> {
	const res = await adminRaw(registryHighestByCodePath(), 'GET');
	if (res.status === 200) {
		const rows = (res.data as { rows?: { key?: unknown }[] })?.rows ?? [];
		const key = rows[0]?.key;
		return typeof key === 'number' && Number.isSafeInteger(key) && key > 0 ? key : 0;
	}
	if (res.status === 404) {
		throw new ServiceError('INTERNAL', 'Registry code index is not available');
	}
	throw new ServiceError('INTERNAL', 'Could not read highest shelter code');
}

/**
 * Idempotent PUT of the registry `_design/app` (the `by_code` view). Safe to
 * re-run: skips the write when the deployed doc already matches.
 */
export async function deployRegistryDesign(): Promise<{ status: number; updated: boolean }> {
	const desired = buildRegistryDesignDoc();
	for (let attempt = 0; attempt < 3; attempt++) {
		const existing = await adminRaw(`/${SHELTER_REGISTRY_DB}/${REGISTRY_DESIGN_ID}`, 'GET');
		if (existing.status !== 200 && existing.status !== 404) {
			throw new ServiceError(
				'INTERNAL',
				`Could not read registry _design/app (${existing.status})`
			);
		}
		const current =
			existing.status === 200
				? (existing.data as {
						_rev?: string;
						version?: number;
						views?: Record<string, { map: string }>;
						validate_doc_update?: string;
					})
				: null;

		const matchesDesired =
			current?.version === desired.version &&
			current?.validate_doc_update === buildRegistryValidateDocUpdate() &&
			Object.entries(desired.views).every(
				([name, view]) => current.views?.[name]?.map === view.map
			);
		if (matchesDesired) {
			return { status: 304, updated: false };
		}

		const res = await adminRaw(`/${SHELTER_REGISTRY_DB}/${REGISTRY_DESIGN_ID}`, 'PUT', {
			...desired,
			...(current?._rev ? { _rev: current._rev } : {})
		});
		if (res.status === 409) continue;
		if (res.status >= 400) {
			const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
			throw new ServiceError(
				'INTERNAL',
				`registry _design/app write failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
		return { status: res.status, updated: true };
	}
	throw new ServiceError(
		'CONFLICT',
		'Could not deploy registry _design/app after concurrent retries'
	);
}

/** Idempotent legacy → current migration wrapper. */
export function migrate(master: ShelterMasterV2 | ShelterMaster): ShelterMaster {
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
		| Promise<{ patch: Partial<ShelterMaster>; meta?: T }>,
	options?: { assertActive?: () => Promise<void> }
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
		await options?.assertActive?.();
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

const SECURITY_LOCK_DB = SHELTER_REGISTRY_DB;
const SECURITY_LOCK_PREFIX = 'shelter_security_lock:';
const SECURITY_LOCK_LEASE_MS = 30_000;

export { buildSecurityMutationLock } from './security-mutation-lock';

function securityLockPath(id: string): string {
	return `/${SECURITY_LOCK_DB}/${encodeURIComponent(id)}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRegistryDatabase(): Promise<void> {
	const res = await adminRaw(`/${SHELTER_REGISTRY_DB}`, 'PUT');
	if (res.status >= 400 && res.status !== 412) {
		const body = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new ServiceError(
			'INTERNAL',
			`registry database setup failed (${res.status}): ${body.reason ?? body.error ?? 'unknown'}`
		);
	}
}

async function acquireSecurityMutationLock(resource: string): Promise<SecurityMutationLock> {
	const id = `${SECURITY_LOCK_PREFIX}${encodeURIComponent(resource)}`;
	const ownerId = `security:${randomUUID()}`;
	for (let attempt = 0; attempt < 8; attempt++) {
		const current = await adminRaw(securityLockPath(id), 'GET');
		if (current.status !== 404 && current.status !== 200) {
			const body = (current.data as { reason?: string; error?: string } | null) ?? {};
			throw new ServiceError(
				'INTERNAL',
				`security lock read failed (${current.status}): ${body.reason ?? body.error ?? 'unknown'}`
			);
		}
		const existing = current.status === 200 ? (current.data as SecurityMutationLock) : null;
		const leaseUntil = Date.parse(existing?.lease_until ?? '');
		if (existing && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
			await sleep(25 + attempt * 25);
			continue;
		}
		const next = buildSecurityMutationLock({
			id,
			ownerId,
			resource,
			leaseUntil: new Date(Date.now() + SECURITY_LOCK_LEASE_MS).toISOString(),
			rev: existing?._rev
		});
		const put = await adminRaw(securityLockPath(id), 'PUT', next);
		if (put.status === 409) continue;
		if (put.status >= 400) {
			const body = (put.data as { reason?: string; error?: string } | null) ?? {};
			throw new ServiceError(
				'INTERNAL',
				`security lock write failed (${put.status}): ${body.reason ?? body.error ?? 'unknown'}`
			);
		}
		return { ...next, _rev: (put.data as { rev?: string }).rev };
	}
	throw new ServiceError('CONFLICT', `Could not serialize _security update for ${resource}`);
}

async function releaseSecurityMutationLock(lock: SecurityMutationLock): Promise<void> {
	const current = await adminRaw(securityLockPath(lock._id), 'GET');
	if (current.status !== 200) return;
	const document = current.data as SecurityMutationLock;
	if (document.owner_id !== lock.owner_id) return;
	const rev = document._rev;
	const path = rev
		? `${securityLockPath(lock._id)}?rev=${encodeURIComponent(rev)}`
		: securityLockPath(lock._id);
	const deleted = await adminRaw(path, 'DELETE');
	if (deleted.status >= 400 && deleted.status !== 404 && deleted.status !== 409) {
		const body = (deleted.data as { reason?: string; error?: string } | null) ?? {};
		throw new ServiceError(
			'INTERNAL',
			`security lock release failed (${deleted.status}): ${body.reason ?? body.error ?? 'unknown'}`
		);
	}
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
	addMembers: { names?: string[]; roles?: string[] } = {},
	options?: { assertActive?: () => Promise<void> }
): Promise<void> {
	await ensureRegistryDatabase();
	const lock = await acquireSecurityMutationLock(db);
	try {
		await options?.assertActive?.();
		const current = await adminRaw(`/${db}/_security`, 'GET');
		if (current.status >= 400) {
			const detail = (current.data as { reason?: string; error?: string } | null) ?? {};
			throw new ServiceError(
				'INTERNAL',
				`_security read failed (${current.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
		const existing =
			(current.data as {
				admins?: { names?: string[]; roles?: string[] };
				members?: { names?: string[]; roles?: string[] };
			} | null) ?? {};
		await options?.assertActive?.();

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
	} finally {
		await releaseSecurityMutationLock(lock);
	}
}

function uniq<T>(arr: T[]): T[] {
	return [...new Set(arr)];
}

/**
 * Deploy CouchDB Design Documents (Views) for a shelter database.
 *
 * CR-051: Deploys the shelter Map/Reduce views into `_design/app` through the
 * shared lifecycle runner (candidate → warm → promote).
 *
 * Views deployed:
 *   - `occupancy`               — count by `current_stay.status` (total / active / temporary_leave / checked_out / transferred / deceased)
 *   - `demographics_by_age`     — active evacuee count by `birth_year` (พ.ศ.); API buckets age at request time
 *   - `demographics_by_country`     — count by `country` field (req); falls back to 'unknown'
 *   - `registrations_by_date_status` — count movement check-in/out by date and series
 *
 * All views use `?group=true` for per-key breakdown (see CONVENTIONS.md §5).
 * Provisioning delegates to the shared candidate/warm/promote lifecycle so new shelters
 * use the same manifest and metadata as CI/CD redeploys.
 */
export async function deployShelterViews(db: string): Promise<number> {
	try {
		return await deployShelterViewsFn(db, (path, method, body) => adminRaw(path, method, body));
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ServiceError('INTERNAL', msg);
	}
}

/**
 * Idempotent re-PUT of `_design/access` (validate_doc_update) on an existing
 * shelter database. Use after whitelist changes (e.g. CR-034 `audit` type,
 * CR-045 `referral` type) when provisioning did not re-run. Used by admin
 * endpoints; the CLI (`pnpm redeploy:access`) mirrors this logic under
 * plain `tsx` without importing this module (`$env` is SvelteKit-only).
 */
export async function redeployShelterAccessDesign(
	db: string,
	shelterCode: string
): Promise<number> {
	const existing = await adminRaw(`/${db}/_design/access`, 'GET');
	const existingDoc =
		existing.status === 200
			? (existing.data as { _rev?: string; validate_doc_update?: string } | null)
			: null;
	const expected = buildValidateDocUpdate(shelterCode);

	if (existingDoc && existingDoc.validate_doc_update === expected) {
		return 304;
	}

	const rev = existingDoc?._rev;
	const res = await adminRaw(`/${db}/_design/access`, 'PUT', {
		_id: '_design/access',
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: expected
	});
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new ServiceError(
			'INTERNAL',
			`validate_doc_update redeploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return res.status;
}

/**
 * Idempotent deploy of referral Mango indexes on a shelter DB.
 * CouchDB returns 200 when an identical named index already exists.
 */
export async function deployReferralMangoIndexes(db: string): Promise<void> {
	for (const def of REFERRAL_MANGO_INDEXES) {
		const res = await adminRaw(`/${db}/_index`, 'POST', def);
		if (res.status >= 400) {
			const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
			throw new ServiceError(
				'INTERNAL',
				`Mango index ${def.name} deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
	}
}

/**
 * Idempotent deploy of the `stock_ledger` Mango indexes a transfer's balance/idempotency
 * `_find` checks need (CR-059 T-13). CouchDB returns 200 when an identical named index
 * already exists.
 */
export async function deployTransferLedgerMangoIndexes(db: string): Promise<void> {
	for (const def of TRANSFER_LEDGER_MANGO_INDEXES) {
		const res = await adminRaw(`/${db}/_index`, 'POST', def);
		if (res.status >= 400) {
			const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
			throw new ServiceError(
				'INTERNAL',
				`Mango index ${def.name} deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
	}
}
