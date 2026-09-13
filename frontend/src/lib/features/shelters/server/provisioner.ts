import { ulid } from '$lib/db/ulid';
import type { Shelter, ShelterMaster } from '../domain/schema';
import { SHELTER_CAPABILITIES } from '$lib/auth/roles';
import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import {
	SHELTER_REGISTRY_DB,
	deployRegistryDesign,
	deployReferralMangoIndexes,
	deployShelterViews,
	deployTransferLedgerMangoIndexes,
	listShelterMasters,
	mergeShelterSecurity,
	nowIso
} from '$lib/server/shelters.admin';
import { buildValidateDocUpdate, shelterDbName } from '$lib/server/shelter-access-design';
import { publicWriterName } from '$lib/server/couch-public-writer';

export interface ProvisionStep {
	step: string;
	status: number;
}

interface SequenceDoc {
	_id: 'shelter_sequence';
	_rev?: string;
	type: 'shelter_sequence';
	next: number;
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

	for (let attempt = 0; attempt < 8; attempt++) {
		const current = await adminRaw(`/${SHELTER_REGISTRY_DB}/shelter_sequence`, 'GET');
		if (current.status === 200) {
			const doc = current.data as SequenceDoc;
			const next = Number.isInteger(doc.next) && doc.next > 0 ? doc.next : 1;
			const put = await adminRaw(`/${SHELTER_REGISTRY_DB}/shelter_sequence`, 'PUT', {
				...doc,
				type: 'shelter_sequence',
				next: next + 1
			});
			if (put.status === 409) continue;
			assertStatus(put.status, 'shelter sequence write', put.data);
			return `SH${String(next).padStart(3, '0')}`;
		}

		if (current.status !== 404) {
			assertStatus(current.status, 'shelter sequence read', current.data);
		}

		const masters = await listShelterMasters();
		const max = masters.reduce((highest, master) => {
			const match = master.code.match(/^SH(\d+)$/i);
			return match ? Math.max(highest, Number(match[1])) : highest;
		}, 0);
		const next = max + 1;
		const put = await adminRaw(`/${SHELTER_REGISTRY_DB}/shelter_sequence`, 'PUT', {
			_id: 'shelter_sequence',
			type: 'shelter_sequence',
			next: next + 1
		});
		if (put.status === 409) continue;
		assertStatus(put.status, 'shelter sequence bootstrap', put.data);
		return `SH${String(next).padStart(3, '0')}`;
	}
	throw new ServiceError('CONFLICT', 'Could not allocate a shelter code after concurrent retries');
}

/** Provision one shelter. This is shared by the HTTP route and async worker. */
export async function provisionShelter(
	input: Shelter,
	allocatedCode?: string
): Promise<{ ok: true; code: string; db: string; steps: ProvisionStep[] }> {
	const code = allocatedCode ?? (await allocateShelterCode());
	const db = shelterDbName(code);
	const steps: ProvisionStep[] = [];

	const createDb = await adminRaw(`/${db}`, 'PUT');
	assertStatus(createDb.status, 'create-db', createDb.data, [412]);
	steps.push({ step: 'create-db', status: createDb.status });

	const writerName = publicWriterName();
	await mergeShelterSecurity(
		db,
		{ roles: ['system_admin'] },
		{ names: writerName ? [writerName] : [], roles: [`shelter:${code}`] }
	);
	steps.push({ step: 'security', status: 200 });

	const existingAccess = await adminRaw(`/${db}/_design/access`, 'GET');
	if (existingAccess.status !== 200 && existingAccess.status !== 404) {
		assertStatus(existingAccess.status, 'access design read', existingAccess.data);
	}
	const rev =
		existingAccess.status === 200 ? (existingAccess.data as { _rev: string })._rev : undefined;
	const access = await adminRaw(`/${db}/_design/access`, 'PUT', {
		_id: '_design/access',
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: buildValidateDocUpdate(code)
	});
	assertStatus(access.status, 'access design', access.data);
	steps.push({ step: 'design', status: access.status });

	const dashboard = await deployShelterViews(db);
	steps.push({ step: 'design-dashboard', status: dashboard });
	await deployReferralMangoIndexes(db);
	steps.push({ step: 'referral-mango', status: 200 });
	await deployTransferLedgerMangoIndexes(db);
	steps.push({ step: 'transfer-ledger-mango', status: 200 });

	const registry = await adminRaw(`/${SHELTER_REGISTRY_DB}`, 'PUT');
	assertStatus(registry.status, 'registry database', registry.data, [412]);
	await mergeShelterSecurity(
		SHELTER_REGISTRY_DB,
		{ roles: ['system_admin'] },
		{ roles: [...SHELTER_CAPABILITIES] }
	);
	const registryDesign = await deployRegistryDesign();
	steps.push({ step: 'registry-design', status: registryDesign.status });

	const masters = await listShelterMasters();
	const existingMaster = masters.find((master) => master.code === code);
	if (!existingMaster) {
		const ts = nowIso();
		const master: ShelterMaster = {
			_id: `shelter:${ulid()}`,
			type: 'shelter',
			schema_v: 5,
			code,
			...input,
			created_at: ts,
			updated_at: ts
		};
		const masterRes = await adminRaw(
			`/${SHELTER_REGISTRY_DB}/${encodeURIComponent(master._id)}`,
			'PUT',
			master
		);
		assertStatus(masterRes.status, 'registry-master', masterRes.data);
		steps.push({ step: 'registry-master', status: masterRes.status });
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
		const ts = nowIso();
		const res = await adminRaw(`/${db}/${encodeURIComponent(seed._id)}`, 'PUT', {
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
		});
		assertStatus(res.status, `seed:${seed.first_name}`, res.data, [409]);
		steps.push({ step: `seed:${seed.first_name}`, status: res.status });
	}

	return { ok: true, code, db, steps };
}
