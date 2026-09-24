import { ulid } from '$lib/db/ulid';
import { SHELTER_MASTER_SCHEMA_V, type Shelter, type ShelterMaster } from '../domain/schema';
import { SHELTER_CAPABILITIES } from '$lib/auth/roles';
import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import {
	SHELTER_REGISTRY_DB,
	deployRegistryDesign,
	deployReferralMangoIndexes,
	deployKioskLookupMangoIndexes,
	deployShelterViews,
	deployTransferLedgerMangoIndexes,
	findMasterByCode,
	findMasterByName,
	findHighestShelterCodeNumber,
	mergeShelterSecurity,
	nowIso
} from '$lib/server/shelters.admin';
import { buildValidateDocUpdate, shelterDbName } from '$lib/server/shelter-access-design';
import { publicWriterName } from '$lib/server/couch-public-writer';
import {
	acquireShelterNameLock,
	isShelterNameLockHeld,
	normalizeShelterName,
	releaseShelterNameLock
} from '$lib/server/shelter-name-lock';

export interface ProvisionStep {
	step: string;
	status: number;
}

const SHELTER_COUNTER_ID = 'counter:shelter' as const;
const LEGACY_SHELTER_SEQUENCE_ID = 'shelter_sequence' as const;

interface ShelterCounterDoc {
	_id: typeof SHELTER_COUNTER_ID;
	_rev?: string;
	type: 'shelter_counter';
	value: number;
}

interface SequenceBootstrapLock {
	_id: 'shelter_sequence_bootstrap_lock';
	_rev?: string;
	type: 'shelter_sequence_bootstrap_lock';
	owner_id: string;
	lease_until: string;
}

function couchDetail(data: unknown): string {
	const detail = (data as { reason?: string; error?: string } | null) ?? {};
	return detail.reason ?? detail.error ?? 'unknown';
}

function assertStatus(status: number, step: string, data: unknown, allowed: number[] = []): void {
	if (status >= 400 && !allowed.includes(status)) {
		throw new ServiceError('INTERNAL', `${step} failed (${status}): ${couchDetail(data)}`);
	}
}

async function acquireSequenceBootstrapLock(ownerId: string): Promise<boolean> {
	const path = `/${SHELTER_REGISTRY_DB}/shelter_sequence_bootstrap_lock`;
	const current = await adminRaw(path, 'GET');
	if (current.status !== 404 && current.status !== 200) {
		assertStatus(current.status, 'shelter sequence bootstrap lock read', current.data);
	}
	const existing = current.status === 200 ? (current.data as SequenceBootstrapLock) : null;
	if (existing && Date.parse(existing.lease_until) > Date.now() && existing.owner_id !== ownerId) {
		return false;
	}
	const lock: SequenceBootstrapLock = {
		_id: 'shelter_sequence_bootstrap_lock',
		type: 'shelter_sequence_bootstrap_lock',
		owner_id: ownerId,
		lease_until: new Date(Date.now() + 30_000).toISOString(),
		...(existing?._rev ? { _rev: existing._rev } : {})
	};
	const put = await adminRaw(path, 'PUT', lock);
	if (put.status === 409) return false;
	assertStatus(put.status, 'shelter sequence bootstrap lock write', put.data);
	return true;
}

async function releaseSequenceBootstrapLock(ownerId: string): Promise<void> {
	const path = `/${SHELTER_REGISTRY_DB}/shelter_sequence_bootstrap_lock`;
	const current = await adminRaw(path, 'GET');
	if (current.status !== 200) return;
	const lock = current.data as SequenceBootstrapLock;
	if (lock.owner_id !== ownerId) return;
	const deletePath = lock._rev ? `${path}?rev=${encodeURIComponent(lock._rev)}` : path;
	const deleted = await adminRaw(deletePath, 'DELETE');
	if (deleted.status >= 400 && deleted.status !== 404 && deleted.status !== 409) {
		assertStatus(deleted.status, 'shelter sequence bootstrap lock release', deleted.data);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Move the persisted counter forward when the indexed shelter-code view finds
 * a legacy code beyond the counter. The counter write itself is CAS-protected
 * so a concurrent allocator can only move it farther forward, never backward.
 */
async function advanceShelterCounterTo(counterPath: string, minimum: number): Promise<void> {
	for (let attempt = 0; attempt < 4; attempt++) {
		const current = await adminRaw(counterPath, 'GET');
		if (current.status === 404) return;
		assertStatus(current.status, 'shelter counter reconciliation read', current.data);
		const doc = current.data as ShelterCounterDoc;
		const value = Number.isSafeInteger(doc.value) && doc.value >= 0 ? doc.value : 0;
		if (value >= minimum) return;
		const put = await adminRaw(counterPath, 'PUT', {
			...doc,
			_id: SHELTER_COUNTER_ID,
			type: 'shelter_counter',
			value: minimum
		});
		if (put.status === 409) continue;
		assertStatus(put.status, 'shelter counter reconciliation write', put.data);
		return;
	}
	throw new ServiceError('CONFLICT', 'Could not reconcile the shelter code counter');
}

/**
 * Allocate the next SH code using a CouchDB MVCC sequence document. The first
 * allocation bootstraps from the existing maximum, while subsequent
 * allocations advance the document with an `_rev` compare-and-swap.
 */
export async function allocateShelterCode(): Promise<string> {
	// The registry may not exist on a fresh installation. Create it before the
	// sequence document is read/written; the later provisioning steps still
	// apply the canonical security and design documents.
	const registry = await adminRaw(`/${SHELTER_REGISTRY_DB}`, 'PUT');
	assertStatus(registry.status, 'registry database', registry.data, [412]);
	// Ensure the indexed code lookup exists before checking a candidate. The
	// sequence remains the allocator; the lookup only prevents a stale sequence
	// value from handing out a code already occupied by a legacy document.
	await deployRegistryDesign();
	const bootstrapOwner = `sequence-bootstrap:${ulid()}`;
	const counterPath = `/${SHELTER_REGISTRY_DB}/${encodeURIComponent(SHELTER_COUNTER_ID)}`;
	const legacySequencePath = `/${SHELTER_REGISTRY_DB}/${encodeURIComponent(LEGACY_SHELTER_SEQUENCE_ID)}`;

	for (let attempt = 0; attempt < 8; attempt++) {
		const current = await adminRaw(counterPath, 'GET');
		if (current.status === 200) {
			const doc = current.data as ShelterCounterDoc;
			const last = Number.isSafeInteger(doc.value) && doc.value >= 0 ? doc.value : 0;
			if (last >= Number.MAX_SAFE_INTEGER) {
				throw new ServiceError('CONFLICT', 'Shelter code counter is exhausted');
			}
			const next = last + 1;
			const code = `SH${String(next).padStart(3, '0')}`;
			const put = await adminRaw(counterPath, 'PUT', {
				...doc,
				_id: SHELTER_COUNTER_ID,
				type: 'shelter_counter',
				value: next
			});
			if (put.status === 409) continue;
			assertStatus(put.status, 'shelter counter write', put.data);
			if (await findMasterByCode(code)) {
				const highest = await findHighestShelterCodeNumber();
				if (highest >= next) await advanceShelterCounterTo(counterPath, highest);
				continue;
			}
			return code;
		}

		if (current.status !== 404) {
			assertStatus(current.status, 'shelter sequence read', current.data);
		}

		const locked = await acquireSequenceBootstrapLock(bootstrapOwner);
		if (!locked) {
			await sleep(50);
			continue;
		}
		try {
			// Re-read after taking the lock: another allocator may have completed
			// bootstrap while this request was waiting on the revision.
			const afterLock = await adminRaw(counterPath, 'GET');
			if (afterLock.status === 200) continue;
			if (afterLock.status !== 404) {
				assertStatus(afterLock.status, 'shelter counter read after lock', afterLock.data);
			}
			const legacy = await adminRaw(legacySequencePath, 'GET');
			if (legacy.status !== 200 && legacy.status !== 404) {
				assertStatus(legacy.status, 'legacy shelter sequence read', legacy.data);
			}
			const legacyNext =
				legacy.status === 200 ? (legacy.data as { next?: unknown }).next : undefined;
			const legacyLast =
				typeof legacyNext === 'number' && Number.isSafeInteger(legacyNext) && legacyNext > 0
					? legacyNext - 1
					: 0;
			const next = Math.max(await findHighestShelterCodeNumber(), legacyLast) + 1;
			if (!Number.isSafeInteger(next)) {
				throw new ServiceError('CONFLICT', 'Shelter code counter is exhausted');
			}
			const code = `SH${String(next).padStart(3, '0')}`;
			const put = await adminRaw(counterPath, 'PUT', {
				_id: SHELTER_COUNTER_ID,
				type: 'shelter_counter',
				value: next
			});
			if (put.status === 409) continue;
			assertStatus(put.status, 'shelter counter bootstrap', put.data);
			if (await findMasterByCode(code)) {
				const highest = await findHighestShelterCodeNumber();
				if (highest >= next) await advanceShelterCounterTo(counterPath, highest);
				continue;
			}
			return code;
		} finally {
			await releaseSequenceBootstrapLock(bootstrapOwner).catch(() => undefined);
		}
	}
	throw new ServiceError('CONFLICT', 'Could not allocate a shelter code after concurrent retries');
}

export interface ProvisionOptions {
	/** Set when the caller already holds the shared name lock. */
	lockOwnerId?: string;
	/** Fence long-running provisioning when the caller's claim/lease is lost. */
	assertActive?: () => Promise<void>;
}

/** Provision one shelter. This is shared by the HTTP route and async worker. */
export async function provisionShelter(
	input: Shelter,
	allocatedCode?: string,
	options?: ProvisionOptions
): Promise<{ ok: true; code: string; db: string; steps: ProvisionStep[] }> {
	const lockOwnerId = options?.lockOwnerId ?? `single:${ulid()}`;
	const ownsNameLock = !options?.lockOwnerId;
	if (ownsNameLock) {
		const acquired = await acquireShelterNameLock({ name: input.name, ownerId: lockOwnerId });
		if (!acquired) {
			throw new ServiceError('CONFLICT', `Shelter name "${input.name}" is being provisioned`);
		}
	}
	try {
		const assertActive = async () => {
			await options?.assertActive?.();
			if (!(await isShelterNameLockHeld({ name: input.name, ownerId: lockOwnerId }))) {
				throw new ServiceError(
					'CONFLICT',
					`Shelter name lock for "${input.name}" is no longer held`
				);
			}
		};
		await assertActive();
		return await provisionShelterUnlocked(input, allocatedCode, assertActive);
	} finally {
		if (ownsNameLock) {
			await releaseShelterNameLock({ name: input.name, ownerId: lockOwnerId }).catch(
				() => undefined
			);
		}
	}
}

async function provisionShelterUnlocked(
	input: Shelter,
	allocatedCode?: string,
	assertActive?: () => Promise<void>
): Promise<{ ok: true; code: string; db: string; steps: ProvisionStep[] }> {
	const normalizedName = normalizeShelterName(input.name);
	const duplicateByName = await findMasterByName(input.name);
	if (duplicateByName && duplicateByName.code !== allocatedCode) {
		throw new ServiceError('CONFLICT', `Shelter name "${input.name}" already exists`);
	}
	const code = allocatedCode ?? (await allocateShelterCode());
	const existingByCode = await findMasterByCode(code);
	if (existingByCode && normalizeShelterName(existingByCode.name) !== normalizedName) {
		throw new ServiceError('CONFLICT', `Shelter code "${code}" already belongs to another shelter`);
	}
	const db = shelterDbName(code);
	const steps: ProvisionStep[] = [];

	await assertActive?.();
	const createDb = await adminRaw(`/${db}`, 'PUT');
	assertStatus(createDb.status, 'create-db', createDb.data, [412]);
	steps.push({ step: 'create-db', status: createDb.status });

	const writerName = publicWriterName();
	await assertActive?.();
	await mergeShelterSecurity(
		db,
		{ roles: ['system_admin'] },
		{ names: writerName ? [writerName] : [], roles: [`shelter:${code}`] },
		{ assertActive }
	);
	steps.push({ step: 'security', status: 200 });

	const existingAccess = await adminRaw(`/${db}/_design/access`, 'GET');
	if (existingAccess.status !== 200 && existingAccess.status !== 404) {
		assertStatus(existingAccess.status, 'access design read', existingAccess.data);
	}
	const expectedValidateDocUpdate = buildValidateDocUpdate(code);
	const existingAccessDoc =
		existingAccess.status === 200
			? (existingAccess.data as { _rev: string; validate_doc_update?: string })
			: null;
	if (existingAccessDoc?.validate_doc_update === expectedValidateDocUpdate) {
		steps.push({ step: 'design', status: 304 });
	} else {
		await assertActive?.();
		const access = await adminRaw(`/${db}/_design/access`, 'PUT', {
			_id: '_design/access',
			...(existingAccessDoc?._rev ? { _rev: existingAccessDoc._rev } : {}),
			validate_doc_update: expectedValidateDocUpdate
		});
		assertStatus(access.status, 'access design', access.data);
		steps.push({ step: 'design', status: access.status });
	}

	await assertActive?.();
	const dashboard = await deployShelterViews(db);
	steps.push({ step: 'design-dashboard', status: dashboard });
	await assertActive?.();
	await deployReferralMangoIndexes(db);
	steps.push({ step: 'referral-mango', status: 200 });
	await assertActive?.();
	await deployKioskLookupMangoIndexes(db);
	steps.push({ step: 'kiosk-lookup-mango', status: 200 });
	await assertActive?.();
	await deployTransferLedgerMangoIndexes(db);
	steps.push({ step: 'transfer-ledger-mango', status: 200 });

	await assertActive?.();
	const registry = await adminRaw(`/${SHELTER_REGISTRY_DB}`, 'PUT');
	assertStatus(registry.status, 'registry database', registry.data, [412]);
	await assertActive?.();
	await mergeShelterSecurity(
		SHELTER_REGISTRY_DB,
		{ roles: ['system_admin'] },
		{ roles: [...SHELTER_CAPABILITIES] },
		{ assertActive }
	);
	await assertActive?.();
	const registryDesign = await deployRegistryDesign();
	steps.push({ step: 'registry-design', status: registryDesign.status });

	const existingMaster = await findMasterByCode(code);
	if (!existingMaster) {
		await assertActive?.();
		const ts = nowIso();
		const master: ShelterMaster = {
			_id: `shelter:${ulid()}`,
			type: 'shelter',
			schema_v: SHELTER_MASTER_SCHEMA_V,
			code,
			...input,
			created_at: ts,
			updated_at: ts
		};
		let masterRes: { status: number; data: unknown };
		try {
			masterRes = await adminRaw(
				`/${SHELTER_REGISTRY_DB}/${encodeURIComponent(master._id)}`,
				'PUT',
				master
			);
		} catch (error) {
			// The PUT may have committed even when its response was lost. A
			// successful code lookup makes that outcome safe to resume.
			const persisted = await findMasterByCode(code).catch(() => null);
			if (!persisted || normalizeShelterName(persisted.name) !== normalizedName) throw error;
			masterRes = { status: 409, data: { reason: 'response lost after commit' } };
		}
		if (masterRes.status === 409) {
			const persisted = await findMasterByCode(code);
			if (!persisted || normalizeShelterName(persisted.name) !== normalizedName) {
				throw new ServiceError('CONFLICT', `Shelter code "${code}" could not be created safely`);
			}
			steps.push({ step: 'registry-master', status: 200 });
		} else {
			assertStatus(masterRes.status, 'registry-master', masterRes.data);
			steps.push({ step: 'registry-master', status: masterRes.status });
		}
	} else {
		steps.push({ step: 'registry-master', status: 200 });
	}

	const seeds = [
		{
			_id: 'evacuee:seed-somchai',
			first_name: 'Somchai',
			last_name: 'Jaidee',
			gender: 'male',
			phone: '0811111111'
		},
		{
			_id: 'evacuee:seed-malee',
			first_name: 'Malee',
			last_name: 'Suksai',
			gender: 'female',
			phone: null
		}
	];
	for (const seed of seeds) {
		await assertActive?.();
		const ts = nowIso();
		const seedDoc = {
			...seed,
			type: 'evacuee',
			schema_v: 1,
			shelter_code: code,
			created_at: ts,
			updated_at: ts,
			created_by: 'seed',
			special_needs: [],
			household_id: null,
			current_stay: { status: 'pre_registered', zone: null, since: ts },
			privacy: { search_excluded: false },
			registered_via: 'import'
		};
		let res: { status: number; data: unknown };
		try {
			res = await adminRaw(`/${db}/${encodeURIComponent(seed._id)}`, 'PUT', seedDoc);
		} catch (error) {
			const persisted = await adminRaw(`/${db}/${encodeURIComponent(seed._id)}`, 'GET').catch(
				() => ({ status: 0, data: null })
			);
			const existing =
				persisted.status === 200 ? (persisted.data as Record<string, unknown>) : null;
			if (
				!existing ||
				existing.type !== 'evacuee' ||
				existing.shelter_code !== code ||
				existing.first_name !== seed.first_name ||
				existing.last_name !== seed.last_name
			) {
				throw error;
			}
			res = { status: 409, data: { reason: 'response lost after commit' } };
		}
		if (res.status === 409) {
			const persisted = await adminRaw(`/${db}/${encodeURIComponent(seed._id)}`, 'GET');
			const existing =
				persisted.status === 200 ? (persisted.data as Record<string, unknown>) : null;
			if (
				!existing ||
				existing.type !== 'evacuee' ||
				existing.shelter_code !== code ||
				existing.first_name !== seed.first_name ||
				existing.last_name !== seed.last_name
			) {
				throw new ServiceError('CONFLICT', `Seed ${seed._id} belongs to an unexpected document`);
			}
			steps.push({ step: `seed:${seed.first_name}`, status: 200 });
		} else {
			assertStatus(res.status, `seed:${seed.first_name}`, res.data);
			steps.push({ step: `seed:${seed.first_name}`, status: res.status });
		}
	}

	return { ok: true, code, db, steps };
}
