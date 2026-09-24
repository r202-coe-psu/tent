/**
 * Platform master seed: master_data + config:app + catalog/SOP/food-sphere.
 */
import { APP_CONFIG_DEFAULTS, APP_CONFIG_DOC_ID } from '$lib/features/shared/domain/app-config';
import { DEFAULT_PUBLIC_PORTAL_CONFIG } from '$lib/features/public-portal/domain/config.fixture';
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
import { type MasterLookup } from './types';
import {
	FALLBACK_UNIT_DEFINITIONS,
	isCanonicalUnitCode,
	isLegacyUnitLabel,
	type FallbackUnitDef
} from '$lib/features/catalog/domain/unit-of-measure';

const canonicalUnitCodes = new Set(FALLBACK_UNIT_DEFINITIONS.map((unit) => unit.code));
const legacySeedBaseUnits = new Set(['kit', 'tent']);

function itemLabelTh(item: { label_th?: string; label?: string }): string {
	return (item.label_th ?? item.label ?? '').trim();
}

function isKnownSeedUnitCode(
	value: unknown,
	existingUnitCodes: ReadonlySet<string>
): value is string {
	if (typeof value !== 'string') return false;
	const code = value.trim();
	return canonicalUnitCodes.has(code) || existingUnitCodes.has(code);
}

function normalizeKnownSeedUnitCode(
	value: unknown,
	existingUnitCodes: ReadonlySet<string>
): string | undefined {
	return isKnownSeedUnitCode(value, existingUnitCodes) ? value.trim() : undefined;
}

function normalizeLegacyBaseUnit(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return isLegacyUnitLabel(trimmed) || legacySeedBaseUnits.has(trimmed) ? trimmed : undefined;
}

export function assertItemMasterSeedUomCodes(
	doc: Record<string, unknown>,
	existingUnitCodes: ReadonlySet<string> = new Set()
): void {
	const itemName = typeof doc.name === 'string' ? doc.name : doc._id;
	const assertCode = (value: unknown, field: string) => {
		if (value === undefined || value === null || value === '') return;
		if (isKnownSeedUnitCode(value, existingUnitCodes)) return;
		if (field === 'base_unit' && normalizeLegacyBaseUnit(value)) return;
		throw new Error(`Invalid UOM code in ${itemName}.${field}: ${String(value)}`);
	};

	assertCode(doc.base_unit, 'base_unit');
	assertCode(doc.default_inventory_uom, 'default_inventory_uom');
	assertCode(doc.default_issue_uom, 'default_issue_uom');
	if (doc.conversions === undefined) return;
	if (!Array.isArray(doc.conversions)) {
		throw new Error(`Invalid conversions in ${itemName}: expected an array`);
	}
	for (const [index, conversion] of doc.conversions.entries()) {
		if (!isRecord(conversion)) {
			throw new Error(`Invalid conversion in ${itemName}.conversions[${index}]`);
		}
		assertCode(conversion.uom_name, `conversions[${index}].uom_name`);
	}
}

type ExistingItemMasterSeedRef = {
	_id: string;
	_rev?: string;
	base_unit?: unknown;
	default_inventory_uom?: unknown;
	default_issue_uom?: unknown;
	conversions?: unknown;
};

function resolveItemMasterConversions(
	existing: unknown,
	configured: unknown,
	existingUnitCodes: ReadonlySet<string>
): unknown[] {
	const existingConversions = Array.isArray(existing) ? existing : [];
	const configuredConversions = Array.isArray(configured) ? configured : [];
	const conversions: unknown[] = [];

	for (
		let index = 0;
		index < Math.max(existingConversions.length, configuredConversions.length);
		index++
	) {
		const existingConversion = existingConversions[index];
		const existingCode = isRecord(existingConversion)
			? normalizeKnownSeedUnitCode(existingConversion.uom_name, existingUnitCodes)
			: undefined;
		if (existingCode) {
			conversions.push({ ...existingConversion, uom_name: existingCode });
			continue;
		}
		if (configuredConversions[index] !== undefined) conversions.push(configuredConversions[index]);
	}

	return conversions;
}

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
		const existingItems = existing?.items ?? [];
		const persistedByLabel = new Map(
			existingItems.map((i) => [itemLabelTh(i as { label_th?: string; label?: string }), i])
		);
		const persistedByCode = new Map(existingItems.map((i) => [i.code, i]));
		if (def.type === 'vulnerable_group' && existing?.items) {
			for (const item of existing.items) {
				const th = itemLabelTh(item as { label_th?: string; label?: string });
				const migratedKey = VG_LEGACY_LABEL_TO_KEY[th] ?? VG_CODE_MIGRATE[item.code];
				if (migratedKey) {
					const target = def.items.find((d) => d.key === migratedKey);
					if (target && !persistedByLabel.has(target.label_th)) {
						persistedByLabel.set(target.label_th, {
							...item,
							label_th: target.label_th,
							label_en: target.label_en,
							code: migratedKey
						});
					}
				}
			}
		}

		const takenCodes = new Set<string>();
		const resolved: Record<string, MasterDataItem> = {};
		const seeded: MasterDataItem[] = def.items.map((d) => {
			const reuseByLabel = persistedByLabel.get(d.label_th);
			const reuseByKey = persistedByCode.get(d.key);
			const reuse = reuseByLabel ?? reuseByKey;
			// Prefer semantic `d.key`. Rewrite seed-owned legacy `item_*` codes on re-seed
			// when the target key is free.
			let code = d.key;
			if (reuse) {
				const reuseCode = reuse.code;
				const isLegacyUlid = /^item_/i.test(reuseCode);
				if (!isLegacyUlid) {
					code = reuseCode;
				} else if (takenCodes.has(d.key) || (persistedByCode.has(d.key) && !reuseByKey)) {
					code = reuseCode;
				} else {
					code = d.key;
				}
			}
			takenCodes.add(code);
			const item: MasterDataItem = {
				code,
				label_th: d.label_th,
				label_en: d.label_en,
				is_default: d.is_default ?? false,
				status: 'active',
				...(d.category ? { category: d.category } : {}),
				...(d.description ? { description: d.description } : {})
			};
			resolved[d.key] = item;
			return item;
		});
		master[def.type] = resolved;

		const seededLabels = new Set(def.items.map((d) => d.label_th));
		const seededKeys = new Set(def.items.map((d) => d.key));
		const seededCodes = new Set(seeded.map((i) => i.code));
		const extras = existingItems.filter((i) => {
			const th = itemLabelTh(i as { label_th?: string; label?: string });
			if (seededLabels.has(th) || seededCodes.has(i.code) || seededKeys.has(i.code)) {
				return false;
			}
			if (def.type === 'vulnerable_group') {
				const migrated = VG_CODE_MIGRATE[i.code] ?? VG_LEGACY_LABEL_TO_KEY[th];
				if (migrated) return false;
			}
			// Drop seed-owned legacy ULID rows that were rewritten to d.key above
			if (/^item_/i.test(i.code) && seededKeys.has(dKeyForLegacy(def, i))) return false;
			return true;
		});
		const items = enforceOneDefault([...seeded, ...extras]);

		await putDoc('registry', {
			_id: id,
			...(existing?._rev ? { _rev: existing._rev } : {}),
			type: 'master_data',
			schema_v: 4,
			master_type: def.type,
			items,
			created_at: existing?.created_at ?? ts,
			updated_at: ts,
			created_by: 'seed'
		});
		const reused = seeded.filter(
			(i) => persistedByLabel.has(i.label_th) || persistedByCode.has(i.code)
		).length;
		console.log(
			`  ✓ registry: master_data ${def.type} (${seeded.length} seeded, ${reused} codes reused` +
				`${extras.length ? `, ${extras.length} existing kept` : ''})`
		);
	}

	return master;
}

function dKeyForLegacy(
	def: (typeof MASTER_DATA_DEFS)[number],
	item: { label_th?: string; label?: string; code: string }
): string {
	const th = itemLabelTh(item);
	return def.items.find((d) => d.label_th === th)?.key ?? '';
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

export const PUBLIC_PORTAL_CONFIG_DOC_ID = 'config:public_portal';

export async function seedPublicPortalConfig(): Promise<void> {
	await ensureDb('registry');
	const ts = now();
	const id = PUBLIC_PORTAL_CONFIG_DOC_ID;
	const { status: getStatus } = await couchReq('GET', `/registry/${encodeURIComponent(id)}`);
	if (getStatus === 200) {
		console.log(`  · registry: ${id} already present — left as is`);
		return;
	}

	await putDoc('registry', {
		_id: id,
		type: 'config',
		schema_v: 1,
		...DEFAULT_PUBLIC_PORTAL_CONFIG,
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

function buildUnitOfMeasureSeedDoc(
	def: FallbackUnitDef,
	existing?: Record<string, unknown>
): Record<string, unknown> {
	const docId = `unit_of_measure:${def.code}`;

	if (!existing) {
		return catalogDoc(
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
				deactivated: def.deactivated ?? false
			},
			1
		);
	}

	return {
		...existing,
		_id: docId,
		type: 'unit_of_measure',
		schema_v: 1,
		code: def.code,
		label_th:
			typeof existing.label_th === 'string' && existing.label_th.trim()
				? existing.label_th
				: def.label_th,
		label_en:
			typeof existing.label_en === 'string' && existing.label_en.trim()
				? existing.label_en
				: def.label_en,
		...(typeof existing.label_th_short === 'string'
			? { label_th_short: existing.label_th_short }
			: def.label_th_short
				? { label_th_short: def.label_th_short }
				: {}),
		dimension: def.dimension,
		is_protected: true,
		sort_order: typeof existing.sort_order === 'number' ? existing.sort_order : def.sort_order,
		deactivated: typeof existing.deactivated === 'boolean' ? existing.deactivated : false,
		updated_at: now()
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateExistingUnitOfMeasure(
	def: FallbackUnitDef,
	docId: string,
	data: unknown
): Record<string, unknown> {
	if (!isRecord(data)) {
		throw new Error(`GET ${docId} → catalog returned an invalid document`);
	}
	if (data._id !== docId || data.type !== 'unit_of_measure') {
		throw new Error(`Cannot seed ${docId}: existing document has the wrong type or ID`);
	}
	if (data.code !== def.code) {
		throw new Error(`Cannot seed ${docId}: existing UOM code is immutable`);
	}
	if (typeof data._rev !== 'string' || !data._rev) {
		throw new Error(`Cannot seed ${docId}: existing document has no CouchDB revision`);
	}
	for (const field of ['created_at', 'updated_at', 'created_by'] as const) {
		if (typeof data[field] !== 'string' || !data[field].trim()) {
			throw new Error(`Cannot seed ${docId}: existing document has an invalid ${field}`);
		}
	}
	for (const field of ['label_th', 'label_th_short', 'label_en'] as const) {
		if (field in data && data[field] !== undefined && typeof data[field] !== 'string') {
			throw new Error(`Cannot seed ${docId}: existing document has an invalid ${field}`);
		}
	}
	if (
		'sort_order' in data &&
		data.sort_order !== undefined &&
		typeof data.sort_order !== 'number'
	) {
		throw new Error(`Cannot seed ${docId}: existing document has an invalid sort_order`);
	}
	if (
		'deactivated' in data &&
		data.deactivated !== undefined &&
		typeof data.deactivated !== 'boolean'
	) {
		throw new Error(`Cannot seed ${docId}: existing document has an invalid deactivated flag`);
	}
	if (data.dimension !== def.dimension) {
		throw new Error(`Cannot seed ${docId}: UOM dimension is immutable`);
	}
	return data;
}

export async function seedCatalogUnitOfMeasures(): Promise<number> {
	let seededCount = 0;
	const maxAttempts = 3;

	for (const def of FALLBACK_UNIT_DEFINITIONS) {
		const docId = `unit_of_measure:${def.code}`;
		let written = false;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const { status, data } = await couchReq('GET', `/catalog/${encodeURIComponent(docId)}`);

			if (status !== 200 && status !== 404) {
				throw new Error(`GET ${docId} → catalog failed (HTTP ${status})`);
			}

			const existing = status === 200 ? validateExistingUnitOfMeasure(def, docId, data) : undefined;
			const next = buildUnitOfMeasureSeedDoc(def, existing);
			const put = await couchReq('PUT', `/catalog/${encodeURIComponent(docId)}`, next);

			if (put.status >= 200 && put.status < 300) {
				written = true;
				break;
			}
			if (put.status !== 409 || attempt === maxAttempts) {
				throw new Error(`PUT ${docId} → catalog failed (HTTP ${put.status})`);
			}
		}

		if (!written) {
			throw new Error(
				`PUT ${docId} → catalog conflict did not resolve after ${maxAttempts} attempts`
			);
		}
		seededCount++;
	}

	return seededCount;
}

export async function seedCatalog(): Promise<Map<string, string>> {
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
								code?: unknown;
								base_unit?: unknown;
								default_inventory_uom?: unknown;
								default_issue_uom?: unknown;
								conversions?: unknown;
							};
						}>;
					}
				).rows
			: [];
	const existingCategoriesByName = new Map<string, { _id: string; _rev?: string }>();
	const existingItemMastersByName = new Map<string, ExistingItemMasterSeedRef>();
	const existingRecipesByLabel = new Map<string, { _id: string; _rev?: string }>();
	const existingUnitCodes = new Set<string>();

	for (const row of allDocs) {
		const doc = row.doc;
		if (!doc) continue;
		if (
			doc.type === 'unit_of_measure' &&
			typeof doc.code === 'string' &&
			isCanonicalUnitCode(doc.code)
		) {
			existingUnitCodes.add(doc.code.trim());
		} else if (doc.type === 'item_category' && doc.name) {
			existingCategoriesByName.set(doc.name, { _id: doc._id, _rev: doc._rev });
		} else if (doc.type === 'item_master' && doc.name) {
			existingItemMastersByName.set(doc.name, {
				_id: doc._id,
				_rev: doc._rev,
				base_unit: doc.base_unit,
				default_inventory_uom: doc.default_inventory_uom,
				default_issue_uom: doc.default_issue_uom,
				conversions: doc.conversions
			});
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
		dietary: [],
		target_gender: 'ALL',
		age_group: 'ALL'
	} as const;

	const itemMastersDef: Array<{
		name: string;
		category: string;
		base_unit: string;
		type_class: 'CONSUMABLE' | 'DURABLE' | 'EQUIPMENT';
		extra?: Record<string, unknown>;
	}> = [
		{
			name: 'ข้าวสาร',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'kg',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [
					{ uom_name: 'bag', multiplier: '5' },
					{ uom_name: 'bag', multiplier: '50' }
				],
				default_inventory_uom: 'bag',
				default_issue_uom: 'kg',
				storage_type: 'DRY',
				shelf_life_days: 365
			}
		},
		{
			name: 'ไข่ไก่',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'piece',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'pack', multiplier: '30' }],
				default_inventory_uom: 'pack',
				default_issue_uom: 'piece',
				storage_type: 'DRY',
				shelf_life_days: 21
			}
		},
		{
			name: 'ผักรวม',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'kg',
			type_class: 'CONSUMABLE',
			extra: {
				storage_type: 'CHILLED',
				shelf_life_days: 5
			}
		},
		{
			name: 'ปลากระป๋อง',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'can',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [
					{ uom_name: 'pack', multiplier: '10' },
					{ uom_name: 'box', multiplier: '100' }
				],
				default_inventory_uom: 'box',
				default_issue_uom: 'can',
				storage_type: 'DRY',
				shelf_life_days: 730,
				dietary: ['HALAL']
			}
		},
		{
			name: 'เนื้อไก่สด',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'kg',
			type_class: 'CONSUMABLE',
			extra: {
				storage_type: 'CHILLED',
				shelf_life_days: 3,
				dietary: ['HALAL']
			}
		},
		{
			name: 'น้ำมันพืช',
			category: 'อาหารและวัตถุดิบ',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'box', multiplier: '12' }],
				default_inventory_uom: 'box',
				default_issue_uom: 'bottle',
				storage_type: 'DRY',
				shelf_life_days: 365,
				dietary: ['HALAL']
			}
		},
		{
			name: 'น้ำดื่ม 600 มล.',
			category: 'น้ำดื่มสะอาด',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'pack', multiplier: '12' }],
				default_inventory_uom: 'pack',
				default_issue_uom: 'bottle',
				storage_type: 'DRY',
				shelf_life_days: 365
			}
		},
		{
			name: 'น้ำดื่มถัง 5 ลิตร',
			category: 'น้ำดื่มสะอาด',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'pack', multiplier: '4' }],
				default_inventory_uom: 'pack',
				default_issue_uom: 'bottle',
				storage_type: 'DRY',
				shelf_life_days: 365
			}
		},
		{
			name: 'สบู่ก้อน',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'bar',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'pack', multiplier: '4' }],
				default_inventory_uom: 'pack',
				default_issue_uom: 'bar',
				storage_type: 'DRY',
				shelf_life_days: 730
			}
		},
		{
			name: 'ยาสีฟัน',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'tube',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'pack', multiplier: '6' }],
				default_inventory_uom: 'pack',
				default_issue_uom: 'tube',
				storage_type: 'DRY',
				shelf_life_days: 730
			}
		},
		{
			name: 'แปรงสีฟัน',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'piece',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'pack', multiplier: '12' }],
				default_inventory_uom: 'pack',
				default_issue_uom: 'piece',
				storage_type: 'DRY'
			}
		},
		{
			name: 'ผ้าอนามัย',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'pack',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'box', multiplier: '24' }],
				default_inventory_uom: 'box',
				default_issue_uom: 'pack',
				storage_type: 'DRY',
				shelf_life_days: 1095,
				target_gender: 'FEMALE'
			}
		},
		{
			name: 'ผงซักฟอก',
			category: 'สุขอนามัยและของใช้ส่วนตัว',
			base_unit: 'bag',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'box', multiplier: '12' }],
				default_inventory_uom: 'box',
				default_issue_uom: 'bag',
				storage_type: 'DRY',
				shelf_life_days: 730
			}
		},
		{
			name: 'ยาพาราเซตามอล 500 มก.',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'tablet',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [
					{ uom_name: 'pack', multiplier: '10' },
					{ uom_name: 'box', multiplier: '100' }
				],
				default_inventory_uom: 'box',
				default_issue_uom: 'tablet',
				storage_type: 'CONTROLLED_MED',
				shelf_life_days: 730
			}
		},
		{
			name: 'ชุดทำแผลปฐมพยาบาล',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'set',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'box', multiplier: '10' }],
				default_inventory_uom: 'box',
				default_issue_uom: 'set',
				storage_type: 'DRY',
				shelf_life_days: 730
			}
		},
		{
			name: 'แอลกอฮอล์ล้างแผล 70%',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'bottle',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'box', multiplier: '24' }],
				default_inventory_uom: 'box',
				default_issue_uom: 'bottle',
				storage_type: 'DRY',
				shelf_life_days: 1095
			}
		},
		{
			name: 'ผงเกลือแร่ ORS',
			category: 'เวชภัณฑ์และการปฐมพยาบาล',
			base_unit: 'sachet',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'box', multiplier: '50' }],
				default_inventory_uom: 'box',
				default_issue_uom: 'sachet',
				storage_type: 'DRY',
				shelf_life_days: 730
			}
		},
		{
			name: 'ผ้าอ้อมผู้ใหญ่ ไซส์ L',
			category: 'ของใช้กลุ่มเปราะบาง',
			base_unit: 'piece',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [
					{ uom_name: 'pack', multiplier: '10' },
					{ uom_name: 'box', multiplier: '80' }
				],
				default_inventory_uom: 'box',
				default_issue_uom: 'piece',
				storage_type: 'DRY',
				shelf_life_days: 1095,
				age_group: 'ELDERLY'
			}
		},
		{
			name: 'ผ้าอ้อมเด็ก ไซส์ M',
			category: 'ของใช้กลุ่มเปราะบาง',
			base_unit: 'piece',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [
					{ uom_name: 'pack', multiplier: '20' },
					{ uom_name: 'box', multiplier: '120' }
				],
				default_inventory_uom: 'box',
				default_issue_uom: 'piece',
				storage_type: 'DRY',
				shelf_life_days: 1095,
				age_group: 'CHILD'
			}
		},
		{
			name: 'นมผงสำหรับทารก',
			category: 'ของใช้กลุ่มเปราะบาง',
			base_unit: 'can',
			type_class: 'CONSUMABLE',
			extra: {
				conversions: [{ uom_name: 'box', multiplier: '12' }],
				default_inventory_uom: 'box',
				default_issue_uom: 'can',
				storage_type: 'DRY',
				shelf_life_days: 365,
				age_group: 'INFANT'
			}
		},
		{
			name: 'เสื้อกั๊กสะท้อนแสง',
			category: 'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร',
			base_unit: 'piece',
			type_class: 'EQUIPMENT',
			extra: { returnable: true, asset_status: 'READY' }
		},
		{
			name: 'รองเท้าบูทยางกันน้ำ',
			category: 'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร',
			base_unit: 'pair',
			type_class: 'EQUIPMENT',
			extra: { returnable: true, asset_status: 'READY' }
		},
		{
			name: 'ข้าวกล่องทั่วไป',
			category: 'อาหารปรุงเสร็จและเครื่องดื่ม',
			base_unit: 'box',
			type_class: 'CONSUMABLE',
			extra: { storage_type: 'DRY', shelf_life_days: 1, distribution_type: 'recurring' }
		},
		{
			name: 'ข้าวกล่องฮาลาล',
			category: 'อาหารปรุงเสร็จและเครื่องดื่ม',
			base_unit: 'box',
			type_class: 'CONSUMABLE',
			extra: {
				storage_type: 'DRY',
				shelf_life_days: 1,
				distribution_type: 'recurring',
				dietary: ['HALAL']
			}
		},
		{
			name: 'ผ้าห่มกันหนาว',
			category: 'เครื่องนอนและที่พักพิง',
			base_unit: 'piece',
			type_class: 'DURABLE',
			extra: {
				conversions: [{ uom_name: 'bundle', multiplier: '10' }],
				default_inventory_uom: 'bundle',
				default_issue_uom: 'piece',
				returnable: true,
				qty_per_person: 1,
				distribution_type: 'one_time'
			}
		},
		{
			name: 'เสื่อปูนอน',
			category: 'เครื่องนอนและที่พักพิง',
			base_unit: 'piece',
			type_class: 'DURABLE',
			extra: {
				conversions: [{ uom_name: 'bundle', multiplier: '10' }],
				default_inventory_uom: 'bundle',
				default_issue_uom: 'piece',
				returnable: true,
				qty_per_person: 1,
				distribution_type: 'one_time'
			}
		},
		{
			name: 'เต็นท์ครอบครัว',
			category: 'เครื่องนอนและที่พักพิง',
			base_unit: 'piece',
			type_class: 'DURABLE',
			extra: {
				default_inventory_uom: 'piece',
				default_issue_uom: 'piece',
				returnable: true,
				qty_per_person: 1,
				distribution_type: 'one_time'
			}
		},
		{
			name: 'ถังแก๊สหุงต้ม LPG 15 กก.',
			category: 'เชื้อเพลิงและพลังงาน',
			base_unit: 'cylinder',
			type_class: 'CONSUMABLE',
			extra: {
				fuel_type: 'LPG',
				capacity_kg: '15',
				burn_rate_kg_per_hour: '0.35',
				time_multiplier: '1'
			}
		},
		{
			name: 'ถุงยังชีพธารน้ำใจ',
			category: 'ชุดพัสดุยังชีพรวม',
			base_unit: 'set',
			type_class: 'CONSUMABLE',
			extra: {
				default_inventory_uom: 'set',
				default_issue_uom: 'set',
				storage_type: 'DRY',
				shelf_life_days: 180,
				distribution_type: 'one_time'
			}
		}
	];

	const itemMasterIdByName = new Map<string, string>();
	const isUlidMasterId = (id?: string) =>
		Boolean(id && /^item_master:[0-9A-HJKMNP-TV-Z]{26}$/.test(id));
	const legacyItemMasterDocsToDelete: Array<{ _id: string; _rev: string }> = [];

	const itemMasters = itemMastersDef.map((def) => {
		const existing = existingItemMastersByName.get(def.name);
		let id: string;
		let rev: string | undefined;

		if (existing && isUlidMasterId(existing._id)) {
			id = existing._id;
			rev = existing._rev;
		} else {
			id = `item_master:${ulid()}`;
			if (existing && existing._rev) {
				legacyItemMasterDocsToDelete.push({ _id: existing._id, _rev: existing._rev });
			}
		}

		itemMasterIdByName.set(def.name, id);
		const isStockItem = def.type_class !== 'EQUIPMENT';
		const configuredInventoryUom =
			typeof def.extra?.default_inventory_uom === 'string'
				? def.extra.default_inventory_uom
				: def.base_unit;
		const configuredIssueUom =
			typeof def.extra?.default_issue_uom === 'string'
				? def.extra.default_issue_uom
				: def.base_unit;
		const existingInventoryUom =
			normalizeKnownSeedUnitCode(existing?.default_inventory_uom, existingUnitCodes) ??
			configuredInventoryUom;
		const existingIssueUom =
			normalizeKnownSeedUnitCode(existing?.default_issue_uom, existingUnitCodes) ??
			configuredIssueUom;
		const existingBaseUnit =
			normalizeKnownSeedUnitCode(existing?.base_unit, existingUnitCodes) ??
			normalizeLegacyBaseUnit(existing?.base_unit);
		const conversions = resolveItemMasterConversions(
			existing?.conversions,
			def.extra?.conversions,
			existingUnitCodes
		);
		const preservedEquipmentUoms = !isStockItem
			? {
					...(normalizeKnownSeedUnitCode(existing?.default_inventory_uom, existingUnitCodes)
						? {
								default_inventory_uom: normalizeKnownSeedUnitCode(
									existing?.default_inventory_uom,
									existingUnitCodes
								)
							}
						: {}),
					...(normalizeKnownSeedUnitCode(existing?.default_issue_uom, existingUnitCodes)
						? {
								default_issue_uom: normalizeKnownSeedUnitCode(
									existing?.default_issue_uom,
									existingUnitCodes
								)
							}
						: {})
				}
			: {};
		const itemMasterDoc = catalogDoc(
			id,
			'item_master',
			{
				name: def.name,
				category: def.category,
				base_unit: existingBaseUnit ?? def.base_unit,
				type_class: def.type_class,
				...itemMasterBase,
				...(def.extra ?? {}),
				conversions,
				...(isStockItem
					? {
							default_inventory_uom: existingInventoryUom,
							default_issue_uom: existingIssueUom
						}
					: {}),
				...preservedEquipmentUoms,
				...(rev ? { _rev: rev } : {})
			},
			4
		);
		assertItemMasterSeedUomCodes(itemMasterDoc, existingUnitCodes);
		return itemMasterDoc;
	});

	const recipesDef = [
		{
			label: 'ข้าวไข่เจียว',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'ไข่ไก่', quantity: '2', uom: 'piece' }
			]
		},
		{
			label: 'ข้าวต้มไก่สับ',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.15', uom: 'kg' },
				{ name: 'เนื้อไก่สด', quantity: '0.1', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวกะเพราไก่สับ',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'เนื้อไก่สด', quantity: '0.15', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวไก่ผัดกระเทียม',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'เนื้อไก่สด', quantity: '0.15', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวไข่พะโล้ไก่',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'ไข่ไก่', quantity: '2', uom: 'piece' },
				{ name: 'เนื้อไก่สด', quantity: '0.1', uom: 'kg' }
			]
		},
		{
			label: 'ข้าวปลากระป๋องทรงเครื่อง',
			ingredients: [
				{ name: 'ข้าวสาร', quantity: '0.2', uom: 'kg' },
				{ name: 'ปลากระป๋อง', quantity: '0.5', uom: 'can' }
			]
		}
	];

	const isUlidRecipeId = (id?: string) => Boolean(id && /^recipe:[0-9A-HJKMNP-TV-Z]{26}$/.test(id));
	const legacyRecipeDocsToDelete: Array<{ _id: string; _rev: string }> = [];

	const recipes = recipesDef.map((r) => {
		const existing = existingRecipesByLabel.get(r.label);
		let id: string;
		let rev: string | undefined;

		if (existing && isUlidRecipeId(existing._id)) {
			id = existing._id;
			rev = existing._rev;
		} else {
			id = `recipe:${ulid()}`;
			if (existing && existing._rev) {
				legacyRecipeDocsToDelete.push({ _id: existing._id, _rev: existing._rev });
			}
		}

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
				...(rev ? { _rev: rev } : {})
			},
			4
		);
	});

	const uomCount = await seedCatalogUnitOfMeasures();

	for (const legacy of [...legacyItemMasterDocsToDelete, ...legacyRecipeDocsToDelete]) {
		await couchReq(
			'DELETE',
			`/catalog/${encodeURIComponent(legacy._id)}?rev=${encodeURIComponent(legacy._rev)}`
		);
	}

	for (const doc of [...itemCategories, ...itemMasters, ...recipes]) await putDoc('catalog', doc);
	console.log(
		`  ✓ catalog: ${uomCount} units of measure, ${itemMasters.length} item masters, ${recipes.length} recipes`
	);

	await deployCatalogMangoIndexes('catalog');
	return itemMasterIdByName;
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

export async function seedCatalogFoodSphereParameters(
	itemMasterIdByName?: Map<string, string>
): Promise<void> {
	await ensureDb('catalog');

	const idByName = itemMasterIdByName ?? new Map<string, string>();
	const { status, data } = await couchReq('GET', '/catalog/_all_docs?include_docs=true');
	const existingDocsById = new Map<string, { _rev?: string }>();

	if (status === 200 && data && typeof data === 'object' && 'rows' in data) {
		for (const row of (
			data as {
				rows: Array<{
					id: string;
					doc?: { _id: string; _rev?: string; type?: string; name?: string };
				}>;
			}
		).rows) {
			if (row.doc?._id && row.doc?._rev) {
				existingDocsById.set(row.doc._id, { _rev: row.doc._rev });
			}
			if (
				!itemMasterIdByName &&
				row.doc?.type === 'item_master' &&
				row.doc.name &&
				row.doc._id &&
				!idByName.has(row.doc.name)
			) {
				idByName.set(row.doc.name, row.doc._id);
			}
		}
	}

	const resolveItemMasterId = (name: string, fallback: string): string => {
		const resolved = idByName.get(name);
		if (!resolved) {
			console.warn(
				`  ⚠ seedCatalogFoodSphereParameters: item_master "${name}" not found in catalog; falling back to "${fallback}"`
			);
			return fallback;
		}
		return resolved;
	};

	const itemNameToId: Record<string, string> = {
		ข้าวสาร: resolveItemMasterId('ข้าวสาร', 'item_master:rice'),
		ไข่ไก่: resolveItemMasterId('ไข่ไก่', 'item_master:egg'),
		ปลากระป๋อง: resolveItemMasterId('ปลากระป๋อง', 'item_master:canned-fish'),
		เนื้อไก่สด: resolveItemMasterId('เนื้อไก่สด', 'item_master:chicken'),
		น้ำมันพืช: resolveItemMasterId('น้ำมันพืช', 'item_master:oil'),
		'น้ำดื่ม 600 มล.': resolveItemMasterId('น้ำดื่ม 600 มล.', 'item_master:water-600ml'),
		'น้ำดื่มถัง 5 ลิตร': resolveItemMasterId('น้ำดื่มถัง 5 ลิตร', 'item_master:water-5l')
	};

	const requirementGroups = DEFAULT_REQUIREMENT_GROUPS.map((rg) => {
		const itemMaps = rg.item_maps?.map((m) => {
			let resolvedId = m.item_id;
			if (m.item_id === 'item_master:rice' && itemNameToId['ข้าวสาร'])
				resolvedId = itemNameToId['ข้าวสาร'];
			else if (m.item_id === 'item_master:egg' && itemNameToId['ไข่ไก่'])
				resolvedId = itemNameToId['ไข่ไก่'];
			else if (m.item_id === 'item_master:canned-fish' && itemNameToId['ปลากระป๋อง'])
				resolvedId = itemNameToId['ปลากระป๋อง'];
			else if (m.item_id === 'item_master:chicken' && itemNameToId['เนื้อไก่สด'])
				resolvedId = itemNameToId['เนื้อไก่สด'];
			else if (m.item_id === 'item_master:oil' && itemNameToId['น้ำมันพืช'])
				resolvedId = itemNameToId['น้ำมันพืช'];
			else if (m.item_id === 'item_master:water-600ml' && itemNameToId['น้ำดื่ม 600 มล.'])
				resolvedId = itemNameToId['น้ำดื่ม 600 มล.'];
			else if (m.item_id === 'item_master:water-5l' && itemNameToId['น้ำดื่มถัง 5 ลิตร'])
				resolvedId = itemNameToId['น้ำดื่มถัง 5 ลิตร'];
			return { ...m, item_id: resolvedId };
		});
		return { ...rg, item_maps: itemMaps };
	});

	for (const doc of requirementGroups) {
		const existing = existingDocsById.get(doc._id);
		await putDoc('catalog', { ...doc, ...(existing?._rev ? { _rev: existing._rev } : {}) });
	}
	for (const doc of DEFAULT_FOOD_SPHERE_STANDARDS) {
		const existing = existingDocsById.get(doc._id);
		await putDoc('catalog', { ...doc, ...(existing?._rev ? { _rev: existing._rev } : {}) });
	}
	for (const doc of DEFAULT_REPLENISHMENT_POLICIES) {
		const existing = existingDocsById.get(doc._id);
		await putDoc('catalog', { ...doc, ...(existing?._rev ? { _rev: existing._rev } : {}) });
	}

	console.log(
		`  ✓ catalog: ${requirementGroups.length} requirement groups, ` +
			`${DEFAULT_FOOD_SPHERE_STANDARDS.length} food sphere standards, ` +
			`${DEFAULT_REPLENISHMENT_POLICIES.length} replenishment policies seeded`
	);
}

/** Full master/platform layer (no shelters, people, or test users). */
export async function runMasterSeed(): Promise<MasterLookup> {
	const master = await seedMasterData();
	await seedAppConfig();
	await seedPublicPortalConfig();
	const itemMasterIdByName = await seedCatalog();
	await seedCatalogSopRatios();
	await seedCatalogFoodSphereParameters(itemMasterIdByName);
	return master;
}
