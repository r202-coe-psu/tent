/**
 * Platform master seed: master_data + config:app + catalog/SOP/food-sphere.
 */
import { APP_CONFIG_DEFAULTS, APP_CONFIG_DOC_ID } from '$lib/features/shared/domain/app-config';
import {
	enforceOneDefault,
	masterDocId,
	type MasterData,
	type MasterDataItem
} from '$lib/features/master-data/domain';
import {
	createInitialProfile,
	SOP_MASTER_SCHEMA_VERSION,
	sopMasterSchema
} from '$lib/features/sop-ratios/domain/sop-ratio';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';
import { DEFAULT_FOOD_SPHERE_STANDARDS } from '$lib/features/sop-ratios/domain/food-sphere.fixture';
import { DEFAULT_REPLENISHMENT_POLICIES } from '$lib/features/sop-ratios/domain/replenishment-policy.fixture';
import { DEFAULT_REQUIREMENT_GROUPS } from '$lib/features/sop-ratios/domain/requirement-group.fixture';
import { now } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { bulkDocs, couchReq, ensureDb, putDoc, setSecurity } from './couch';
import { MASTER_DATA_DEFS } from './master-defs';
import { ITEM, masterCode, type MasterLookup } from './types';
import { FALLBACK_UNIT_DEFINITIONS } from '$lib/features/catalog/domain/unit-of-measure';

const itemCode = () => `item_${ulid().toLowerCase()}`;

function catalogDoc(id: string, type: string, body: Record<string, unknown>, schemaV = 1) {
	const ts = now();
	return {
		_id: id,
		type,
		schema_v: schemaV,
		created_at: ts,
		updated_at: ts,
		created_by: 'seed',
		...body
	};
}

export async function seedMasterData(): Promise<MasterLookup> {
	await ensureDb('registry');
	const ts = now();
	const master = {} as MasterLookup;

	const VG_LEGACY_LABEL_TO_KEY: Record<string, string> = {
		ผู้สูงอายุ: 'elderly_dependent',
		ผู้พิการ: 'disability_other',
		ผู้ป่วยเรื้อรัง: 'chronic_illness'
	};
	const VG_CODE_MIGRATE: Record<string, string> = {
		elderly: 'elderly_dependent',
		disabled: 'disability_other'
	};

	for (const def of MASTER_DATA_DEFS) {
		const id = masterDocId(def.type);
		const { status: getStatus, data } = await couchReq(
			'GET',
			`/registry/${encodeURIComponent(id)}`
		);
		const existing = getStatus === 200 ? (data as MasterData) : null;
		const persistedByLabel = new Map((existing?.items ?? []).map((i) => [i.label, i]));
		if (def.type === 'vulnerable_group' && existing?.items) {
			for (const item of existing.items) {
				const migratedKey = VG_LEGACY_LABEL_TO_KEY[item.label] ?? VG_CODE_MIGRATE[item.code];
				if (migratedKey) {
					const target = def.items.find((d) => d.key === migratedKey);
					if (target && !persistedByLabel.has(target.label)) {
						persistedByLabel.set(target.label, {
							...item,
							label: target.label,
							code: migratedKey
						});
					}
				}
			}
		}

		const resolved: Record<string, MasterDataItem> = {};
		const seeded: MasterDataItem[] = def.items.map((d) => {
			const reuse = persistedByLabel.get(d.label);
			const item: MasterDataItem = {
				code:
					reuse?.code ??
					(def.type === 'vulnerable_group' ||
					def.type === 'housing_type' ||
					def.type === 'pet_types'
						? d.key
						: itemCode()),
				label: d.label,
				is_default: d.is_default ?? false,
				status: 'active',
				...(d.parent_key
					? { parent_code: masterCode(master, def.parent_type!, d.parent_key) }
					: {}),
				...(d.category ? { category: d.category } : {}),
				...(d.description ? { description: d.description } : {})
			};
			resolved[d.key] = item;
			return item;
		});
		master[def.type] = resolved;

		const seededLabels = new Set(def.items.map((d) => d.label));
		const seededCodes = new Set(seeded.map((i) => i.code));
		const extras = (existing?.items ?? []).filter((i) => {
			if (seededLabels.has(i.label) || seededCodes.has(i.code)) return false;
			if (def.type === 'vulnerable_group') {
				const migrated = VG_CODE_MIGRATE[i.code] ?? VG_LEGACY_LABEL_TO_KEY[i.label];
				if (migrated) return false;
			}
			if (def.type === 'pet_types' && (i.code === 'bird' || i.label === 'นก')) return false;
			return true;
		});
		const items = enforceOneDefault([...seeded, ...extras]);

		await putDoc('registry', {
			_id: id,
			...(existing?._rev ? { _rev: existing._rev } : {}),
			type: 'master_data',
			schema_v: 3,
			master_type: def.type,
			items,
			created_at: existing?.created_at ?? ts,
			updated_at: ts,
			created_by: 'seed'
		});
		const reused = seeded.filter((i) => persistedByLabel.has(i.label)).length;
		console.log(
			`  ✓ registry: master_data ${def.type} (${seeded.length} seeded, ${reused} codes reused` +
				`${extras.length ? `, ${extras.length} existing kept` : ''})`
		);
	}

	return master;
}

export async function seedAppConfig(): Promise<void> {
	await ensureDb('registry');
	const ts = now();
	const id = APP_CONFIG_DOC_ID;
	const { status: getStatus } = await couchReq('GET', `/registry/${encodeURIComponent(id)}`);
	if (getStatus === 200) {
		console.log(`  · registry: ${id} already present — left as is`);
		return;
	}

	await putDoc('registry', {
		_id: id,
		type: 'config',
		schema_v: 1,
		...APP_CONFIG_DEFAULTS,
		created_at: ts,
		updated_at: ts,
		created_by: 'seed'
	});
	console.log(`  ✓ registry: ${id} (defaults)`);
}

async function deployCatalogMangoIndexes(db: string): Promise<void> {
	await couchReq('POST', `/${db}/_index`, {
		index: { fields: ['type', 'name'] },
		name: 'catalog-type-name-idx',
		type: 'json'
	});
	await couchReq('POST', `/${db}/_index`, {
		index: { fields: ['type', 'target_id'] },
		name: 'catalog-type-target-idx',
		type: 'json'
	});
	await couchReq('POST', `/${db}/_index`, {
		index: { fields: ['type', 'target_segment', 'req_group_id', 'effective_date'] },
		name: 'catalog-food-sphere-idx',
		type: 'json'
	});
	await couchReq('POST', `/${db}/_index`, {
		index: { fields: ['type', 'scope_type', 'target_id'] },
		name: 'catalog-replenishment-policy-idx',
		type: 'json'
	});
	console.log(
		`  ✓ ${db}: Mango indexes for sop_profile, audit, food_sphere, replenishment_policy deployed`
	);
}

export async function seedCatalog(): Promise<void> {
	await ensureDb('catalog');
	await setSecurity('catalog', {
		admins: { names: [], roles: ['system_admin'] },
		members: {
			names: [],
			roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff']
		}
	});

	const ddocId = '_design/access';
	const { status: getStatus, data: existingDdoc } = await couchReq(
		'GET',
		`/catalog/${encodeURIComponent(ddocId)}`
	);
	const rev = getStatus === 200 ? (existingDdoc as { _rev: string })._rev : undefined;
	const validateFn = `function (newDoc, oldDoc, userCtx) {
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
	await couchReq('PUT', `/catalog/${encodeURIComponent(ddocId)}`, {
		_id: ddocId,
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: validateFn
	});

	const items = [
		catalogDoc(ITEM.rice, 'supply_item', {
			name: 'ข้าวสาร',
			category: 'food',
			unit: 'kg',
			perishable: false,
			reorder_level: 50
		}),
		catalogDoc(ITEM.water, 'supply_item', {
			name: 'น้ำดื่ม',
			category: 'water',
			unit: 'bottle',
			perishable: false,
			reorder_level: 200
		}),
		catalogDoc(ITEM.paracetamol, 'supply_item', {
			name: 'ยาพาราเซตามอล',
			category: 'medicine',
			unit: 'tablet',
			perishable: true,
			reorder_level: 500
		}),
		catalogDoc(ITEM.soap, 'supply_item', {
			name: 'สบู่ก้อน',
			category: 'hygiene',
			unit: 'bar',
			perishable: false,
			reorder_level: 100
		}),
		catalogDoc(ITEM.blanket, 'supply_item', {
			name: 'ผ้าห่ม',
			category: 'bedding',
			unit: 'piece',
			perishable: false,
			reorder_level: 30
		}),
		catalogDoc(ITEM.egg, 'supply_item', {
			name: 'ไข่ไก่',
			category: 'food',
			unit: 'piece',
			perishable: true,
			reorder_level: 100
		}),
		catalogDoc(ITEM.vegetable, 'supply_item', {
			name: 'ผักรวม',
			category: 'food',
			unit: 'kg',
			perishable: true,
			reorder_level: 30
		})
	];

	const itemMasterBase = {
		conversions: [],
		distribution_type: 'recurring',
		type_class: 'CONSUMABLE',
		dietary: []
	} as const;
	const itemMasters = [
		catalogDoc(
			'item_master:rice',
			'item_master',
			{ name: 'ข้าวสาร', category: 'food', base_unit: 'kg', ...itemMasterBase },
			4
		),
		catalogDoc(
			'item_master:egg',
			'item_master',
			{ name: 'ไข่ไก่', category: 'food', base_unit: 'piece', ...itemMasterBase },
			4
		),
		catalogDoc(
			'item_master:vegetable',
			'item_master',
			{ name: 'ผักรวม', category: 'food', base_unit: 'kg', ...itemMasterBase },
			4
		),
		catalogDoc(
			'item_master:canned-fish',
			'item_master',
			{ name: 'ปลากระป๋อง', category: 'food', base_unit: 'can', ...itemMasterBase },
			4
		)
	];
	const recipes = [
		catalogDoc(
			'recipe:fried-egg-rice',
			'recipe',
			{
				label: 'ข้าวไข่เจียว',
				standard_portions: '1',
				standard_duration_hours: '1',
				ingredients: [
					{ item_master_id: 'item_master:rice', quantity: '0.2', uom: 'kg' },
					{ item_master_id: 'item_master:egg', quantity: '2', uom: 'piece' }
				]
			},
			4
		),
		catalogDoc(
			'recipe:congee',
			'recipe',
			{
				label: 'ข้าวต้ม',
				standard_portions: '1',
				standard_duration_hours: '1',
				ingredients: [{ item_master_id: 'item_master:rice', quantity: '0.15', uom: 'kg' }]
			},
			4
		),
		catalogDoc(
			'recipe:canned-fish-rice',
			'recipe',
			{
				label: 'ข้าวปลากระป๋อง',
				standard_portions: '1',
				standard_duration_hours: '1',
				ingredients: [
					{ item_master_id: 'item_master:rice', quantity: '0.2', uom: 'kg' },
					{ item_master_id: 'item_master:canned-fish', quantity: '0.5', uom: 'can' }
				]
			},
			4
		)
	];

	let uomCount = 0;
	for (const def of FALLBACK_UNIT_DEFINITIONS) {
		const docId = `unit_of_measure:${def.code}`;
		const { status, data } = await couchReq('GET', `/catalog/${encodeURIComponent(docId)}`);
		if (status === 200) {
			const existing = data as Record<string, unknown>;
			// Idempotent: preserve admin labels while ensuring protected system invariants
			await putDoc('catalog', {
				...existing,
				type: 'unit_of_measure',
				schema_v: 1,
				code: def.code,
				dimension: def.dimension,
				is_protected: true,
				updated_at: now()
			});
		} else {
			await putDoc(
				'catalog',
				catalogDoc(
					docId,
					'unit_of_measure',
					{
						code: def.code,
						label_th: def.label_th,
						...(def.label_th_short ? { label_th_short: def.label_th_short } : {}),
						label_en: def.label_en,
						dimension: def.dimension,
						is_protected: true,
						sort_order: def.sort_order,
						deactivated: false
					},
					1
				)
			);
		}
		uomCount++;
	}

	for (const doc of [...items, ...itemMasters, ...recipes]) await putDoc('catalog', doc);
	console.log(
		`  ✓ catalog: ${uomCount} units of measure, ${items.length} supply items, ${itemMasters.length} item masters, ${recipes.length} recipes`
	);

	await deployCatalogMangoIndexes('catalog');
}

export async function seedCatalogSopRatios(): Promise<void> {
	await ensureDb('catalog');

	const { status: findStatus, data: findData } = await couchReq('POST', '/catalog/_find', {
		selector: { type: 'sop_profile' },
		limit: 1
	});
	if (findStatus !== 200) {
		throw new Error(
			`seedCatalogSopRatios: unable to inspect existing profiles (HTTP ${findStatus})`
		);
	}
	const existingProfiles = (findData as { docs?: unknown[] }).docs ?? [];
	if (existingProfiles.length > 0) {
		console.log('  ✓ catalog: SOP Profiles already exist, skipping seed');
		return;
	}

	const deterministicId = 'master_sphere_baseline';
	const fullDocId = `sop_profile:${deterministicId}`;
	const { status, data } = await couchReq('GET', `/catalog/${encodeURIComponent(fullDocId)}`);

	let existingRev: string | undefined;
	if (status === 200) {
		const doc = data as { _rev?: string; schema_v?: number };
		if (doc.schema_v === SOP_MASTER_SCHEMA_VERSION && sopMasterSchema.safeParse(data).success) {
			console.log('  ✓ catalog: SOP Ratio "Sphere Baseline" already exists, skipping');
			return;
		}
		existingRev = doc._rev;
		console.log(
			`  ⚠ catalog: SOP Ratio "Sphere Baseline" has stale schema_v (${doc.schema_v ?? 'missing'}), preparing upgrade...`
		);
	} else if (status !== 404) {
		throw new Error(`seedCatalogSopRatios: unexpected status ${status} checking ${fullDocId}`);
	}

	const { profile, audit } = createInitialProfile('sop_profile', 'Sphere Baseline', validRatios, {
		createdBy: 'seed'
	});

	profile._id = fullDocId;
	if (existingRev) profile._rev = existingRev;
	audit.target_id = fullDocId;
	audit._id = `audit:seed_sphere_baseline`;

	const pointerDoc = {
		_id: 'sop_profile_active:global',
		type: 'sop_profile_active',
		schema_v: 1,
		active_profile_id: fullDocId,
		active_slug: profile.slug,
		active_version: profile.version,
		updated_at: new Date().toISOString(),
		updated_by: 'seed'
	};

	await bulkDocs('catalog', [profile, audit, pointerDoc]);
	console.log('  ✓ catalog: SOP Ratio "Sphere Baseline" seeded (upgraded if stale)');
}

export async function seedCatalogFoodSphereParameters(): Promise<void> {
	await ensureDb('catalog');

	for (const doc of DEFAULT_REQUIREMENT_GROUPS) {
		await putDoc('catalog', doc);
	}
	for (const doc of DEFAULT_FOOD_SPHERE_STANDARDS) {
		await putDoc('catalog', doc);
	}
	for (const doc of DEFAULT_REPLENISHMENT_POLICIES) {
		await putDoc('catalog', doc);
	}

	console.log(
		`  ✓ catalog: ${DEFAULT_REQUIREMENT_GROUPS.length} requirement groups, ` +
			`${DEFAULT_FOOD_SPHERE_STANDARDS.length} food sphere standards, ` +
			`${DEFAULT_REPLENISHMENT_POLICIES.length} replenishment policies seeded`
	);
}

/** Full master/platform layer (no shelters, people, or test users). */
export async function runMasterSeed(): Promise<MasterLookup> {
	const master = await seedMasterData();
	await seedAppConfig();
	await seedCatalog();
	await seedCatalogSopRatios();
	await seedCatalogFoodSphereParameters();
	return master;
}
