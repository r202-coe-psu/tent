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
				...(d.parent_key ? { parent_code: masterCode(master, def.parent_type!, d.parent_key) } : {})
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
			if (
				def.type === 'dietary_restrictions' &&
				(i.label === 'มังสวิรัติ' || i.label === 'อาหารอ่อน')
			)
				return false;
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

	const { status: catQueryStatus, data: catAllDocs } = await couchReq(
		'GET',
		'/catalog/_all_docs?include_docs=true'
	);
	const allDocs =
		catQueryStatus === 200 && catAllDocs && typeof catAllDocs === 'object' && 'rows' in catAllDocs
			? (
					catAllDocs as {
						rows: Array<{
							id: string;
							doc?: {
								_id: string;
								_rev?: string;
								type?: string;
								name?: string;
								label?: string;
							};
						}>;
					}
				).rows
			: [];
	const existingCategoriesByName = new Map<string, { _id: string; _rev?: string }>();
	const existingItemMastersByName = new Map<string, { _id: string; _rev?: string }>();
	const existingRecipesByLabel = new Map<string, { _id: string; _rev?: string }>();

	for (const row of allDocs) {
		const doc = row.doc;
		if (!doc) continue;
		if (doc.type === 'item_category' && doc.name) {
			existingCategoriesByName.set(doc.name, { _id: doc._id, _rev: doc._rev });
		} else if (doc.type === 'item_master' && doc.name) {
			existingItemMastersByName.set(doc.name, { _id: doc._id, _rev: doc._rev });
		} else if (doc.type === 'recipe' && doc.label) {
			existingRecipesByLabel.set(doc.label, { _id: doc._id, _rev: doc._rev });
		}
	}

	const categoryNames = [
		'อาหารและวัตถุดิบ',
		'น้ำดื่มสะอาด',
		'สุขอนามัยและของใช้ส่วนตัว',
		'เวชภัณฑ์และการปฐมพยาบาล',
		'ของใช้กลุ่มเปราะบาง',
		'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร',
		'อาหารปรุงเสร็จและเครื่องดื่ม',
		'เครื่องนอนและที่พักพิง',
		'เชื้อเพลิงและพลังงาน',
		'ชุดพัสดุยังชีพรวม'
	];

	const itemCategories = categoryNames.map((name) => {
		const existing = existingCategoriesByName.get(name);
		const id = existing?._id ?? `item_category:${ulid()}`;
		return catalogDoc(
			id,
			'item_category',
			{
				name,
				deactivated: false,
				...(existing?._rev ? { _rev: existing._rev } : {})
			},
			2
		);
	});

	const itemMasterBase = {
		conversions: [],
		distribution_type: 'recurring',
		dietary: []
	} as const;

	const itemMastersDef: Array<{
		name: string;
		category: string;
		base_unit: string;
		type_class: 'CONSUMABLE' | 'DURABLE' | 'EQUIPMENT';
		fallbackId?: string;
		extra?: Record<string, unknown>;
	}> = [
		{
			name: 'ข้าวสาร',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'kg',
			type_class: 'CONSUMABLE',
			fallbackId: 'item_master:rice'
		},
		{
			name: 'ไข่ไก่',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'piece',
			type_class: 'CONSUMABLE',
			fallbackId: 'item_master:egg'
		},
		{
			name: 'ผักรวม',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'kg',
			type_class: 'CONSUMABLE',
			fallbackId: 'item_master:vegetable'
		},
		{
			name: 'ปลากระป๋อง',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'can',
			type_class: 'CONSUMABLE',
			fallbackId: 'item_master:canned-fish'
		},
		{
			name: 'เนื้อไก่สด',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'kg',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'น้ำมันพืช',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'น้ำดื่ม 600 มล.',
			category: 'น้ำดื่มสะอาด',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'น้ำดื่มถัง 5 ลิตร',
			category: 'น้ำดื่มสะอาด',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'สบู่ก้อน',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'bar',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ยาสีฟัน',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'tube',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'แปรงสีฟัน',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'piece',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ผ้าอนามัย',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'pack',
			type_class: 'CONSUMABLE',
			extra: { target_gender: 'female' }
		},
		{
			name: 'ผงซักฟอก',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'bag',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ยาพาราเซตามอล 500 มก.',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'tablet',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ชุดทำแผลปฐมพยาบาล',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'kit',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'แอลกอฮอล์ล้างแผล 70%',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ผงเกลือแร่ ORS',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'sachet',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ผ้าอ้อมผู้ใหญ่ ไซส์ L',
			category: 'ของใช้กลุ่มเปราะบาง',
			base_unit: 'piece',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ผ้าอ้อมเด็ก ไซส์ M',
			category: 'ของใช้กลุ่มเปราะบาง',
			base_unit: 'piece',
			type_class: 'CONSUMABLE',
			extra: { age_group: 'CHILD' }
		},
		{
			name: 'นมผงสำหรับทารก',
			category: 'ของใช้กลุ่มเปราะบาง',
			base_unit: 'can',
			type_class: 'CONSUMABLE',
			extra: { age_group: 'INFANT' }
		},
		{
			name: 'เสื้อกั๊กสะท้อนแสง',
			category: 'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร',
			base_unit: 'piece',
			type_class: 'EQUIPMENT',
			extra: { returnable: true }
		},
		{
			name: 'รองเท้าบูทยางกันน้ำ',
			category: 'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร',
			base_unit: 'pair',
			type_class: 'EQUIPMENT',
			extra: { returnable: true }
		},
		{
			name: 'ข้าวกล่องทั่วไป',
			category: 'อาหารปรุงเสร็จและเครื่องดื่ม',
			base_unit: 'box',
			type_class: 'CONSUMABLE'
		},
		{
			name: 'ข้าวกล่องฮาลาล',
			category: 'อาหารปรุงเสร็จและเครื่องดื่ม',
			base_unit: 'box',
			type_class: 'CONSUMABLE',
			extra: { dietary: ['halal'] }
		},
		{
			name: 'ผ้าห่มกันหนาว',
			category: 'เครื่องนอนและที่พักพิง',
			base_unit: 'piece',
			type_class: 'DURABLE',
			extra: { returnable: true }
		},
		{
			name: 'เสื่อปูนอน',
			category: 'เครื่องนอนและที่พักพิง',
			base_unit: 'piece',
			type_class: 'DURABLE',
			extra: { returnable: true }
		},
		{
			name: 'เต็นท์ครอบครัว',
			category: 'เครื่องนอนและที่พักพิง',
			base_unit: 'tent',
			type_class: 'DURABLE',
			extra: { returnable: true }
		},
		{
			name: 'ถังแก๊สหุงต้ม LPG 15 กก.',
			category: 'เชื้อเพลิงและพลังงาน',
			base_unit: 'cylinder',
			type_class: 'CONSUMABLE',
			extra: { fuel_type: 'LPG', capacity_kg: '15', burn_rate_kg_per_hour: '0.35' }
		},
		{
			name: 'ถุงยังชีพธารน้ำใจ',
			category: 'ชุดพัสดุยังชีพรวม',
			base_unit: 'kit',
			type_class: 'CONSUMABLE'
		}
	];

	const itemMasterIdByName = new Map<string, string>();

	const itemMasters = itemMastersDef.map((def) => {
		const existing = existingItemMastersByName.get(def.name);
		const id = existing?._id ?? def.fallbackId ?? `item_master:${ulid()}`;
		itemMasterIdByName.set(def.name, id);
		return catalogDoc(
			id,
			'item_master',
			{
				name: def.name,
				category: def.category,
				base_unit: def.base_unit,
				type_class: def.type_class,
				...itemMasterBase,
				...(def.extra ?? {}),
				...(existing?._rev ? { _rev: existing._rev } : {})
			},
			4
		);
	});

	const recipesDef = [
		{
			label: 'ข้าวไข่เจียว',
			fallbackId: 'recipe:fried-egg-rice',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'ไข่ไก่', quantity: '2', uom: 'piece' }
			]
		},
		{
			label: 'ข้าวต้มไก่สับ',
			fallbackId: 'recipe:congee-chicken',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.15', uom: 'kg' },
				{ name: 'เนื้อไก่สด', quantity: '0.1', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวกะเพราไก่สับ',
			fallbackId: 'recipe:basil-chicken-rice',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'เนื้อไก่สด', quantity: '0.15', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวไก่ผัดกระเทียม',
			fallbackId: 'recipe:garlic-chicken-rice',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'เนื้อไก่สด', quantity: '0.15', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวไข่พะโล้ไก่',
			fallbackId: 'recipe:stewed-egg-chicken',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'ไข่ไก่', quantity: '2', uom: 'piece' },
				{ name: 'เนื้อไก่สด', quantity: '0.1', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวปลากระป๋องทรงเครื่อง',
			fallbackId: 'recipe:canned-fish-rice',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'ปลากระป๋อง', quantity: '0.5', uom: 'can' }
			]
		}
	];

	const recipes = recipesDef.map((r) => {
		const existing = existingRecipesByLabel.get(r.label);
		const id = existing?._id ?? r.fallbackId ?? `recipe:${ulid()}`;
		return catalogDoc(
			id,
			'recipe',
			{
				label: r.label,
				standard_portions: '1',
				standard_duration_hours: '1',
				ingredients: r.ingredients.map((ing) => ({
					item_master_id: itemMasterIdByName.get(ing.name) ?? `item_master:${ing.name}`,
					quantity: ing.quantity,
					uom: ing.uom
				})),
				...(existing?._rev ? { _rev: existing._rev } : {})
			},
			4
		);
	});

	for (const doc of [...items, ...itemCategories, ...itemMasters, ...recipes])
		await putDoc('catalog', doc);
	console.log(
		`  ✓ catalog: ${items.length} supply items, ${itemCategories.length} item categories, ${itemMasters.length} item masters, ${recipes.length} recipes`
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
