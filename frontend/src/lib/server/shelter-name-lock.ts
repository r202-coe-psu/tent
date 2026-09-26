import { adminRaw, ServiceError } from './couch-admin';

const REGISTRY_DB = 'registry';
const LOCK_TYPE = 'shelter_import_name_lock' as const;

interface ShelterNameLock {
	_id: string;
	_rev?: string;
	type: typeof LOCK_TYPE;
	name: string;
	owner_id: string;
	lease_until: string;
	updated_at: string;
	/** Legacy fields are retained so old lock documents remain understandable. */
	job_id?: string;
	item_id?: string;
	worker_id?: string;
}

function detail(data: unknown): string {
	const value = (data as { reason?: string; error?: string } | null) ?? {};
	return value.reason ?? value.error ?? 'unknown';
}

function assertOk(status: number, operation: string, data: unknown): void {
	if (status >= 400) {
		throw new ServiceError('INTERNAL', `${operation} failed (${status}): ${detail(data)}`);
	}
}

function now(): string {
	return new Date().toISOString();
}

/** Trim, collapse internal whitespace, and lowercase a shelter-name key. */
export function normalizeShelterName(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function lockId(name: string): string {
	return `${LOCK_TYPE}:${encodeURIComponent(normalizeShelterName(name))}`;
}

async function getLock(id: string): Promise<ShelterNameLock | null> {
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
	if (res.status === 404) return null;
	assertOk(res.status, `read name lock ${id}`, res.data);
	return res.data as ShelterNameLock;
}

async function ensureRegistryDatabase(): Promise<void> {
	const res = await adminRaw(`/${REGISTRY_DB}`, 'PUT');
	if (res.status >= 400 && res.status !== 412) {
		throw new ServiceError(
			'INTERNAL',
			`registry database setup failed (${res.status}): ${detail(res.data)}`
		);
	}
}

/**
 * Acquire a CouchDB-backed name lock. `ownerId` must identify one logical
 * operation (not merely a worker process), so a reclaimed lease cannot be
 * released or overwritten by the previous attempt.
 */
export async function acquireShelterNameLock(args: {
	name: string;
	ownerId: string;
	leaseMs?: number;
}): Promise<boolean> {
	const normalized = normalizeShelterName(args.name);
	if (!normalized) return true;
	await ensureRegistryDatabase();
	const id = lockId(normalized);
	const leaseMs = args.leaseMs ?? 5 * 60 * 1000;

	for (let attempt = 0; attempt < 5; attempt++) {
		const current = await getLock(id);
		const currentLease = current ? Date.parse(current.lease_until) : NaN;
		if (
			current &&
			Number.isFinite(currentLease) &&
			currentLease > Date.now() &&
			(current.owner_id ?? legacyOwner(current)) !== args.ownerId
		) {
			return false;
		}
		const next: ShelterNameLock = {
			_id: id,
			type: LOCK_TYPE,
			name: normalized,
			owner_id: args.ownerId,
			lease_until: new Date(Date.now() + leaseMs).toISOString(),
			updated_at: now(),
			...(current?._rev ? { _rev: current._rev } : {})
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `acquire name lock ${normalized}`, res.data);
		return true;
	}
	return false;
}

function legacyOwner(lock: ShelterNameLock): string {
	return [lock.job_id, lock.item_id, lock.worker_id].filter(Boolean).join(':');
}

/** Check the current fencing owner without changing the lock document. */
export async function isShelterNameLockHeld(args: {
	name: string;
	ownerId: string;
}): Promise<boolean> {
	const normalized = normalizeShelterName(args.name);
	if (!normalized) return true;
	const current = await getLock(lockId(normalized));
	if (!current) return false;
	const lease = Date.parse(current.lease_until);
	return (
		(current.owner_id ?? legacyOwner(current)) === args.ownerId &&
		Number.isFinite(lease) &&
		lease > Date.now()
	);
}

/** Release only the current owner's lock; an expired/reclaimed lock is fenced. */
export async function releaseShelterNameLock(args: {
	name: string;
	ownerId: string;
}): Promise<void> {
	const normalized = normalizeShelterName(args.name);
	if (!normalized) return;
	const id = lockId(normalized);
	const current = await getLock(id);
	if (!current || (current.owner_id ?? legacyOwner(current)) !== args.ownerId) return;
	const path = current._rev
		? `/${REGISTRY_DB}/${encodeURIComponent(id)}?rev=${encodeURIComponent(current._rev)}`
		: `/${REGISTRY_DB}/${encodeURIComponent(id)}`;
	const res = await adminRaw(path, 'DELETE');
	if (res.status >= 400 && res.status !== 404 && res.status !== 409) {
		assertOk(res.status, `release name lock ${normalized}`, res.data);
	}
}
