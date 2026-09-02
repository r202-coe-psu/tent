/**
 * Server-side auto-bootstrap for central CouchDB databases.
 *
 * Ensures the central databases (`catalog`, `registry`, `thailand_locations`)
 * exist with their required security, access control design documents, and baseline profiles.
 *
 * Safe and idempotent. Runs on server startup and recovers cleanly after `pnpm unseed`.
 */

import { adminRaw } from './couch-admin';
import { mergeShelterSecurity, deployRegistryDesign } from './shelters.admin';
import { SHELTER_CAPABILITIES } from '$lib/auth/roles';
import {
	createInitialProfile,
	SOP_MASTER_SCHEMA_VERSION,
	sopMasterSchema,
	type SopRatioKey
} from '$lib/features/sop-ratios/server';

const CENTRAL_DBS = ['catalog', 'registry', 'thailand_locations'] as const;

const SPHERE_BASELINE_RATIOS: Record<SopRatioKey, string> = {
	water_l_per_person_day: '15',
	drinking_water_l_per_person_day: '3',
	cooking_water_l_per_person_day: '6',
	hygiene_water_l_per_person_day: '6',
	kcal_per_adult_day: '2000',
	people_per_tap: '80',
	people_per_handpump: '500',
	people_per_open_well: '400',
	people_per_laundry: '100',
	people_per_bathing: '50',
	people_per_toilet_female: '20',
	people_per_toilet_male: '35',
	people_per_dining_point_adult: '20',
	people_per_dining_point_child: '10',
	m2_per_person_living: '3.5',
	m2_per_person_living_cold: '4.5',
	m2_per_person_total: '45',
	max_waterpoint_distance_m: '500',
	max_queue_minutes: '30',
	people_per_volunteer: '50'
};

const CATALOG_ACCESS_VDU = `function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1 || userCtx.roles.indexOf('system_admin') !== -1) {
    return;
  }
  if (oldDoc && oldDoc.shelter_code !== newDoc.shelter_code) {
    throw({ forbidden: 'shelter_code is immutable' });
  }
  if (newDoc.shelter_code) {
    var hasScope = userCtx.roles.indexOf('shelter:' + newDoc.shelter_code) !== -1;
    var isManager = userCtx.roles.indexOf('shelter_manager') !== -1;
    var isWS = userCtx.roles.indexOf('warehouse_staff') !== -1;
    if (hasScope && (isManager || isWS)) {
      return;
    }
  }
  throw({ forbidden: 'Only System Admins can write to global catalog documents, and only authorized shelter staff can write local documents.' });
}`;

async function ensureDb(dbName: string): Promise<boolean> {
	const res = await adminRaw(`/${dbName}`, 'PUT');
	// 201 = Created, 412 = Precondition Failed (Already exists)
	return res.status === 201 || res.status === 412;
}

async function ensureCatalogAccessDesign(): Promise<void> {
	const existing = await adminRaw('/catalog/_design/access', 'GET');
	const existingData =
		existing.status === 200
			? (existing.data as { _rev?: string; validate_doc_update?: string } | null)
			: null;

	if (existingData?.validate_doc_update === CATALOG_ACCESS_VDU) {
		return;
	}

	const rev = existingData?._rev;
	await adminRaw('/catalog/_design/access', 'PUT', {
		_id: '_design/access',
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: CATALOG_ACCESS_VDU
	});
}

async function ensureMasterSopBaseline(): Promise<void> {
	const fullDocId = 'sop_profile:master_sphere_baseline';
	const { status, data } = await adminRaw(`/catalog/${encodeURIComponent(fullDocId)}`, 'GET');

	let existingRev: string | undefined;

	if (status === 200) {
		const doc = data as { _rev?: string; schema_v?: number };
		if (doc.schema_v === SOP_MASTER_SCHEMA_VERSION && sopMasterSchema.safeParse(data).success) {
			return;
		}
		existingRev = doc._rev;
	} else if (status !== 404) {
		return;
	}

	const { profile } = createInitialProfile(
		'sop_profile',
		'Sphere Baseline',
		SPHERE_BASELINE_RATIOS,
		{
			createdBy: 'system'
		}
	);
	profile._id = fullDocId;
	if (existingRev) {
		profile._rev = existingRev;
	}

	await adminRaw(`/catalog/${encodeURIComponent(fullDocId)}`, 'PUT', profile);
}

async function ensureThailandLocationIndexes(): Promise<void> {
	const indexes = [
		{ name: 'location-by-province_id', fields: ['province_id'] },
		{ name: 'location-by-district_id', fields: ['district_id'] }
	];

	for (const def of indexes) {
		await adminRaw('/thailand_locations/_index', 'POST', {
			index: { fields: def.fields },
			name: def.name,
			type: 'json'
		});
	}
}

/**
 * Ensures all central databases (`catalog`, `registry`, `thailand_locations`) exist
 * and have the appropriate security and design documents.
 */
export async function ensureCentralDatabases(): Promise<void> {
	try {
		// 1. Ensure DBs exist
		for (const db of CENTRAL_DBS) {
			await ensureDb(db);
		}

		// 2. Security for registry and catalog
		await mergeShelterSecurity(
			'registry',
			{ roles: ['system_admin'] },
			{ roles: [...SHELTER_CAPABILITIES] }
		);

		await mergeShelterSecurity(
			'catalog',
			{ roles: ['system_admin'] },
			{ roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff'] }
		);

		// 3. Catalog access design and baseline SOP profile
		await ensureCatalogAccessDesign();
		await ensureMasterSopBaseline();

		// 4. Registry design doc
		await deployRegistryDesign();

		// 5. Thailand locations indexes
		await ensureThailandLocationIndexes();
	} catch (err) {
		// Do not crash server startup if CouchDB is temporarily unreachable
		console.warn('[Bootstrap] CouchDB not reachable yet during auto-bootstrap:', err);
	}
}
