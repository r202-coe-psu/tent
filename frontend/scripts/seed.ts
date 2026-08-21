/**
 * Mock data seed script for the Smart Shelter dev environment.
 *
 * Usage:  pnpm seed  (from frontend/)
 *         pnpm unseed [--confirm]  — remove seed docs (see scripts/unseed.ts)
 * Needs:  CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 *
 * ## Factory usage
 *
 * | Section                      | Factory               | Source              |
 * |------------------------------|-----------------------|---------------------|
 * | seedShelter — households     | createHousehold       | people domain       |
 * | seedShelter — evacuees       | createEvacuee         | people domain       |
 * | seedShelter — movements      | createMovement        | people domain       |
 * | seedShelter — medicals       | createMedical         | people domain       |
 * | seedShelter — screenings     | createScreening       | people domain       |
 * | seedShelter — stock ledger   | createStockLedger     | operations domain   |
 * | seedShelter — donations      | createWalkInDonation  | operations domain   |
 * | seedShelter — campaigns      | createCampaign        | operations domain   |
 * | seedDailyCalc — daily_calc   | calculateResources    | resource-calc domain (real engine; CR-042 have map) |
 * | seedRegistry — shelter master| plain object          | no factory (server-side only) |
 * | seedCatalog — supply items   | plain object          | no factory (no catalog feature) |
 * | seedCatalog — recipes        | plain object          | no factory (no catalog feature) |
 * | seedUsers — _users staff     | plain CouchDB user    | sa01 + staff01–staff03 test logins |
 *
 * ## Ordering
 *
 * `seedMasterData` runs FIRST and returns a {@link MasterLookup}; the shelter
 * masters and every household/evacuee below reference the item codes it wrote
 * (`shelter_type`, `admission_policy.supported_vulnerable_groups`,
 * `special_needs`, `municipality_zone`, `community`). Nothing hardcodes a master
 * code — see the seedMasterData docblock.
 *
 * Safe to re-run for catalog and registry docs, which use deterministic IDs
 * (PUT → 409 = already exists → skip). Shelter docs use ULIDs so
 * re-running adds another batch — useful for volume testing.
 * Test users (sa01 + staff01–03) are also idempotent (409 → skip).
 * daily_calc is the exception: deterministic snapshots fail on conflict so stale evidence is
 * never reported as freshly seeded; wipe the local seed data before regenerating that window.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_CONFIG_DEFAULTS, APP_CONFIG_DOC_ID } from '$lib/features/shared';
import {
	applyMovementToStay,
	createEvacuee,
	createHousehold,
	createMedical,
	createMovement,
	createScreening,
	type Evacuee,
	type PeopleDoc,
	type EvacueeInput,
	type HouseholdInput,
	type MedicalInput,
	type MovementInput,
	type ScreeningInput
} from '$lib/features/people/domain/people';
import {
	createCampaign,
	createPurchase,
	createStockLedger,
	createWalkInDonation,
	keyPurchaseReceipt,
	parseStockLedger,
	stockBalance,
	type CampaignInput,
	type PurchaseInput,
	type StockLedgerInput,
	type WalkInDonationInput
} from '$lib/features/operations/domain/operations';
import {
	enforceOneDefault,
	masterDocId,
	type MasterData,
	type MasterDataItem,
	type MasterDataType
} from '$lib/features/master-data/domain';
import {
	createInitialProfile,
	SOP_MASTER_SCHEMA_VERSION,
	SOP_RATIO_KIND,
	sopMasterSchema,
	type SopRatioKey
} from '$lib/features/sop-ratios/domain/sop-ratio';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';
import {
	calculateResources,
	FORMULA_V,
	type ResourceInput
} from '$lib/features/resource-calc/domain/calc.formula';
import {
	parseDailyCalcRecord,
	resolveHave,
	type ShelterHaveSource
} from '$lib/features/resource-calc/core';
import {
	dailyCalcDocSchema,
	DAILY_CALC_SCHEMA_VERSION
} from '$lib/features/resource-calc/domain/calc.schema';
import { shelterCodeSchema, type AuthorContext, makeDoc, now } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { deployShelterViewsFn } from '$lib/features/shelters/server/deploy';
import {
	buildValidateDocUpdate,
	REFERRAL_MANGO_INDEXES,
	shelterDbName
} from '$lib/server/shelter-access-design';
import { assertBulkWriteResults, prefixRangeEnd, type BulkWriteResult } from './t31-seed-support';
// ─── env ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

function loadEnv(): Record<string, string> {
	if (!existsSync(envPath)) return {};
	return Object.fromEntries(
		readFileSync(envPath, 'utf-8')
			.split('\n')
			.filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
			.map((l) => {
				const eq = l.indexOf('=');
				const k = l.slice(0, eq).trim();
				const v = l
					.slice(eq + 1)
					.trim()
					.replace(/^['"]|['"]$/g, '');
				return [k, v];
			})
	);
}

const env = loadEnv();
const rawCouchUrl =
	process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL ?? 'http://admin:password@localhost:5984';

// Node's native fetch rejects URLs with embedded credentials — split them out.
function parseCouchUrl(raw: string): { baseUrl: string; authHeader: string } {
	const url = new URL(raw);
	const authHeader =
		url.username || url.password
			? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
			: '';
	url.username = '';
	url.password = '';
	return { baseUrl: url.toString().replace(/\/$/, ''), authHeader };
}

const { baseUrl: COUCH_URL, authHeader: COUCH_AUTH } = parseCouchUrl(rawCouchUrl);

// ─── CouchDB helpers ──────────────────────────────────────────────────────────

async function couchReq(
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (COUCH_AUTH) headers['Authorization'] = COUCH_AUTH;
	const res = await fetch(`${COUCH_URL}${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json();
	return { status: res.status, data };
}

async function ensureDb(name: string): Promise<void> {
	const { status } = await couchReq('PUT', `/${name}`);
	if (status !== 201 && status !== 412)
		throw new Error(`Cannot create database "${name}" (HTTP ${status})`);
}

interface CouchDbSecurity {
	admins?: { names?: string[]; roles?: string[] };
	members?: { names?: string[]; roles?: string[] };
}

async function setSecurity(db: string, security: CouchDbSecurity): Promise<void> {
	// 1. Fetch the existing security object
	const { status: getStatus, data } = await couchReq('GET', `/${db}/_security`);
	const existing = (getStatus === 200 ? data : {}) as CouchDbSecurity;

	// 2. Ensure properties exist
	existing.admins ??= { names: [], roles: [] };
	existing.members ??= { names: [], roles: [] };
	existing.admins.names ??= [];
	existing.admins.roles ??= [];
	existing.members.names ??= [];
	existing.members.roles ??= [];

	// 3. Helper to merge arrays without duplicates
	const merge = (a: string[], b: string[] = []) => Array.from(new Set([...a, ...b]));

	// 4. Merge new roles and names
	existing.admins.roles = merge(existing.admins.roles, security.admins?.roles);
	existing.admins.names = merge(existing.admins.names, security.admins?.names);
	existing.members.roles = merge(existing.members.roles, security.members?.roles);
	existing.members.names = merge(existing.members.names, security.members?.names);

	// 5. Push it back
	const { status } = await couchReq('PUT', `/${db}/_security`, existing);
	if (status !== 200) throw new Error(`Cannot set _security for "${db}" (HTTP ${status})`);
	console.log(`  ✓ ${db}: _security set`);
}

// PUT individual doc — 201 created, 409 conflict (idempotent seed) both ok.
async function putDoc(db: string, doc: Record<string, unknown>): Promise<void> {
	const { status } = await couchReq('PUT', `/${db}/${encodeURIComponent(doc._id as string)}`, doc);
	if (status !== 201 && status !== 409)
		throw new Error(`PUT ${doc._id} → ${db} failed (HTTP ${status})`);
}

async function bulkDocs(
	db: string,
	docs: unknown[],
	options: { allowConflicts?: boolean } = { allowConflicts: true }
): Promise<void> {
	const { status, data } = await couchReq('POST', `/${db}/_bulk_docs`, { docs });
	if (status !== 201) throw new Error(`_bulk_docs to "${db}" failed (HTTP ${status})`);
	assertBulkWriteResults(db, data as BulkWriteResult[], options);
}

// ─── catalog helpers ──────────────────────────────────────────────────────────

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

// ─── constants ────────────────────────────────────────────────────────────────

const SH001_CODE = 'SH001';
const SH001_DB = 'shelter_sh001';
const SH001_CTX: AuthorContext = { shelterCode: SH001_CODE, createdBy: 'seed' };

// Aliases for SH001 to fix broken references in seedShelter and seedDashboardData
const SHELTER_CODE = SH001_CODE;
const SHELTER_DB = SH001_DB;
const ctx = SH001_CTX;
const CTX = SH001_CTX;
const code = SH001_CODE;
const dbName = SH001_DB;

const SHELTER_CODE_2 = 'SH002';
const SHELTER_DB_2 = 'shelter_sh002';
const CTX_2: AuthorContext = { shelterCode: SHELTER_CODE_2, createdBy: 'seed' };

const SHELTER_CODE_3 = 'SH003';

/**
 * Registry master records — upserted on every seed run (name + location always applied).
 *
 * `shelter_type_key` and `admission_policy.supported_vulnerable_group_keys` are
 * seed-only handles into {@link MASTER_DATA_DEFS}; {@link seedRegistry} swaps them
 * for the persisted master_data item codes, which is what those two fields store.
 * A shelter must list every vulnerable-group code its evacuees use — the
 * registration/health forms only offer chips whose code is in this list.
 */
const REGISTRY_SHELTERS = [
	{
		code: SHELTER_CODE,
		name: 'ศูนย์อพยพศูนย์กีฬามหาวิทยาลัยสงขลานครินทร์',
		location: { lat: 7.010027132382802, lng: 100.50024358303605 },
		shelter_type_key: 'sports_centre',
		capacity: 200,
		zones: [
			{ code: 'Z1', name: 'โซน A', capacity: 100 },
			{ code: 'Z2', name: 'โซน B', capacity: 100 }
		],
		area_m2: 800,
		facilities: {
			toilets_female: 4,
			toilets_male: 4,
			toilets_accessible: 2,
			showers: 8,
			water_points: 6,
			handwashing_stations: 10
		},
		admission_policy: {
			pet_policy: {
				policy: 'conditional',
				categories: [{ category: 'small_general' }, { category: 'livestock' }]
			},
			supported_vulnerable_group_keys: [
				'elderly',
				'disabled',
				'wheelchair',
				'bedridden',
				'pregnant',
				'infant',
				'young_child',
				'chronic_illness'
			]
		}
	},
	{
		code: SHELTER_CODE_2,
		name: 'ศูนย์อพยพสำนักงานเทศบาลนครหาดใหญ่',
		location: { lat: 7.015427802879699, lng: 100.47291623646029 },
		shelter_type_key: 'government_building',
		capacity: 100,
		zones: [{ code: 'Z1', name: 'โซนรวม', capacity: 100 }],
		area_m2: 400,
		facilities: {
			toilets_female: 2,
			toilets_male: 2,
			toilets_accessible: 1,
			showers: 4,
			water_points: 2,
			handwashing_stations: 4
		},
		admission_policy: {
			pet_policy: { policy: 'not_allowed' },
			supported_vulnerable_group_keys: ['elderly', 'pregnant', 'chronic_illness']
		}
	},
	{
		// No admission_policy — keeps the "shelter has not configured a policy yet"
		// path covered (registration offers no vulnerable-group chips there).
		code: SHELTER_CODE_3,
		name: 'ศูนย์อพยพสำนักงานเทศบาลเมืองบ้านพรุ',
		location: { lat: 6.948086391528152, lng: 100.47963181135452 },
		shelter_type_key: 'community_hall',
		capacity: 100,
		zones: [
			{ code: 'Z1', name: 'โซนรวม', capacity: 50 },
			{ code: 'Z2', name: 'โซนสัตว์เลี้ยง', capacity: 50, type: 'pet' }
		],
		area_m2: 400,
		facilities: {
			toilets_female: 2,
			toilets_male: 2,
			toilets_accessible: 0,
			showers: 4,
			water_points: 2,
			handwashing_stations: 4
		}
	}
] as const;

// Supply item IDs — referenced by operations seed data below.
const ITEM = {
	rice: 'item:rice',
	water: 'item:water',
	paracetamol: 'item:paracetamol',
	soap: 'item:soap',
	blanket: 'item:blanket',
	egg: 'item:egg',
	vegetable: 'item:vegetable'
} as const;

// ─── seedUsers ────────────────────────────────────────────────────────────────

const USER_PREFIX = 'org.couchdb.user:';
const SEED_STAFF_PASSWORD = '!Q2w3e4r5t';
const SEED_STAFF_ROLES = ['shelter:SH001', 'registration_staff'] as const;

/** Create sa01 + staff01–staff03 test logins in CouchDB `_users` (idempotent). */
async function seedUsers(): Promise<void> {
	const staffNames = ['staff01', 'staff02', 'staff03'] as const;
	let created = 0;
	let skipped = 0;

	const { status: saStatus } = await couchReq(
		'PUT',
		`/_users/${USER_PREFIX}${encodeURIComponent('sa01')}`,
		{
			name: 'sa01',
			password: SEED_STAFF_PASSWORD,
			display_name: 'System Admin',
			roles: ['system_admin'],
			type: 'user',
			shelter_id: null,
			affiliation_tags: []
		}
	);
	if (saStatus === 201) {
		created += 1;
	} else if (saStatus === 409) {
		skipped += 1;
	} else {
		throw new Error(`PUT _users/sa01 failed (HTTP ${saStatus})`);
	}

	for (const name of staffNames) {
		const { status } = await couchReq('PUT', `/_users/${USER_PREFIX}${encodeURIComponent(name)}`, {
			name,
			password: SEED_STAFF_PASSWORD,
			display_name: name,
			roles: [...SEED_STAFF_ROLES],
			type: 'user',
			shelter_id: SH001_CODE,
			affiliation_tags: []
		});
		if (status === 201) {
			created += 1;
		} else if (status === 409) {
			skipped += 1;
		} else {
			throw new Error(`PUT _users/${name} failed (HTTP ${status})`);
		}
	}

	console.log(
		`  ✓ _users: sa01 + staff01–staff03 (password shared; ${created} created, ${skipped} already exist)`
	);
}

// ─── seedRegistry ─────────────────────────────────────────────────────────────

async function seedRegistry(master: MasterLookup): Promise<void> {
	await ensureDb('registry');
	await setSecurity('registry', {
		admins: { names: [], roles: ['system_admin'] },
		members: {
			names: [],
			roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff']
		}
	});

	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	const existingByCode = new Map<string, Record<string, unknown>>();
	if (status === 200) {
		const rows =
			(data as { rows?: { doc?: { type?: string; code?: string } & Record<string, unknown> }[] })
				.rows ?? [];
		for (const row of rows) {
			const doc = row.doc;
			if (doc?.type === 'shelter' && typeof doc.code === 'string') {
				existingByCode.set(doc.code, doc);
			}
		}
	}

	const ts = now();
	for (const shelter of REGISTRY_SHELTERS) {
		const existing = existingByCode.get(shelter.code);

		// Build payload extras — both carry master_data item codes, resolved from
		// the keys declared on REGISTRY_SHELTERS (see seedMasterData).
		const extras: Record<string, unknown> = {
			shelter_type: masterCode(master, 'shelter_type', shelter.shelter_type_key)
		};
		if ('admission_policy' in shelter) {
			const { supported_vulnerable_group_keys, ...policy } = shelter.admission_policy;
			extras.admission_policy = {
				...policy,
				supported_vulnerable_groups: masterCodes(
					master,
					'vulnerable_group',
					...supported_vulnerable_group_keys
				)
			};
		}

		if (existing) {
			await putDoc('registry', {
				...existing,
				name: shelter.name,
				location: { ...shelter.location },
				zones: shelter.zones.map((z) => ({ ...z })),
				updated_at: ts,
				...extras
			});
			console.log(`  ✓ registry: updated shelter ${shelter.code} (name + location + policies)`);
		} else {
			await putDoc('registry', {
				_id: `shelter:${ulid()}`,
				type: 'shelter',
				schema_v: 1,
				code: shelter.code,
				name: shelter.name,
				location: { ...shelter.location },
				status: 'open',
				capacity: shelter.capacity,
				zones: shelter.zones.map((z) => ({ ...z })),
				area_m2: shelter.area_m2,
				facilities: { ...shelter.facilities },
				opened_at: ts,
				created_at: ts,
				updated_at: ts,
				created_by: 'seed',
				...extras
			});
			console.log(`  ✓ registry: 1 shelter master (${shelter.code})`);
		}
	}
}

// ─── seedMasterData ───────────────────────────────────────────────────────────

/**
 * Global master_data docs (CR-049) — one doc per type (`master_data:{type}`).
 *
 * Master data is seeded FIRST, and every downstream section references what it
 * actually wrote: shelter `admission_policy.supported_vulnerable_groups` +
 * `shelter_type`, evacuee `special_needs`, household `municipality_zone` +
 * `community`. Those fields persist the item **`code`**, and codes are ULIDs
 * (`item_{ulid}`) — never slugs, matching the UI-create rule — so they cannot be
 * written by hand. Instead every item carries a `key` (seed-script only, never
 * persisted); {@link seedMasterData} resolves `key` → persisted item and returns
 * a {@link MasterLookup} that later sections read through {@link masterCode} /
 * {@link masterLabel}. An unknown key throws rather than writing a dangling ref.
 *
 * Re-running against a populated registry reuses the codes already stored (items
 * are matched back by `label`), so evacuee/household docs written by an earlier
 * run keep resolving instead of pointing at regenerated ULIDs.
 *
 * Types with no doc field to link to yet (`dietary_restrictions`, `house_damage`,
 * `pet_types` — `PetGroup.species` is a fixed domain enum, not a master code) are
 * seeded for the config screens only.
 */
const itemCode = () => `item_${ulid().toLowerCase()}`;

/** One item to seed. `key` is a seed-only handle; `code` is generated/reused. */
type SeedItemDef = {
	key: string;
	label: string;
	is_default?: boolean;
	/** `key` of the owning item in `parent_type` (community → municipality zone). */
	parent_key?: string;
};

type MasterTypeDef = {
	type: MasterDataType;
	/** Type `parent_key` resolves against — must appear earlier in the list. */
	parent_type?: MasterDataType;
	items: SeedItemDef[];
};

/** Resolved `master_type` → seed `key` → the item as persisted. */
type MasterLookup = Record<MasterDataType, Record<string, MasterDataItem>>;

function masterItem(master: MasterLookup, type: MasterDataType, key: string): MasterDataItem {
	const item = master[type]?.[key];
	if (!item) throw new Error(`seed: no master_data item "${key}" seeded for type "${type}"`);
	return item;
}

const masterCode = (m: MasterLookup, type: MasterDataType, key: string) =>
	masterItem(m, type, key).code;
const masterCodes = (m: MasterLookup, type: MasterDataType, ...keys: string[]) =>
	keys.map((key) => masterCode(m, type, key));
const masterLabel = (m: MasterLookup, type: MasterDataType, key: string) =>
	masterItem(m, type, key).label;
const masterLabels = (m: MasterLookup, type: MasterDataType, ...keys: string[]) =>
	keys.map((key) => masterLabel(m, type, key));

const MASTER_DATA_DEFS: MasterTypeDef[] = [
	{
		type: 'vulnerable_group',
		items: [
			{ key: 'elderly', label: 'ผู้สูงอายุ', is_default: true },
			{ key: 'disabled', label: 'ผู้พิการ' },
			{ key: 'wheelchair', label: 'ผู้ใช้วีลแชร์' },
			{ key: 'bedridden', label: 'ผู้ป่วยติดเตียง' },
			{ key: 'pregnant', label: 'สตรีมีครรภ์' },
			{ key: 'infant', label: 'ทารก' },
			{ key: 'young_child', label: 'เด็กเล็ก' },
			{ key: 'chronic_illness', label: 'ผู้ป่วยเรื้อรัง' }
		]
	},
	{
		type: 'health_condition',
		items: [
			{ key: 'diabetes', label: 'เบาหวาน', is_default: true },
			{ key: 'hypertension', label: 'ความดันโลหิตสูง' },
			{ key: 'heart_disease', label: 'โรคหัวใจ' },
			{ key: 'asthma', label: 'หอบหืด' },
			{ key: 'seafood_allergy', label: 'แพ้อาหารทะเล' },
			{ key: 'sulfa_allergy', label: 'แพ้ยาซัลฟา' }
		]
	},
	{
		type: 'dietary_restrictions',
		items: [
			{ key: 'halal', label: 'อิสลาม (ฮาลาล)', is_default: true },
			{ key: 'vegetarian', label: 'มังสวิรัติ' },
			{ key: 'soft_diet', label: 'อาหารอ่อน' }
		]
	},
	{
		type: 'pet_types',
		items: [
			{ key: 'dog', label: 'สุนัข', is_default: true },
			{ key: 'cat', label: 'แมว' },
			{ key: 'bird', label: 'นก' }
		]
	},
	{
		type: 'house_damage',
		items: [
			{ key: 'total_loss', label: 'เสียหายทั้งหลัง', is_default: true },
			{ key: 'partial', label: 'เสียหายบางส่วน' },
			{ key: 'flooded_first_floor', label: 'น้ำท่วมถึงชั้น 1' }
		]
	},
	{
		type: 'shelter_type',
		items: [
			{ key: 'school', label: 'โรงเรียน', is_default: true },
			{ key: 'community_hall', label: 'ศาลาประชาคม' },
			{ key: 'temple', label: 'วัด' },
			{ key: 'government_building', label: 'อาคารราชการ' },
			{ key: 'sports_centre', label: 'ศูนย์กีฬา' }
		]
	},
	{
		type: 'municipality_zone',
		items: [
			{ key: 'zone_1', label: 'เขตเทศบาล 1', is_default: true },
			{ key: 'zone_2', label: 'เขตเทศบาล 2' },
			{ key: 'zone_3', label: 'เขตเทศบาล 3' },
			{ key: 'zone_4', label: 'เขตเทศบาล 4' }
		]
	},
	{
		// community items point at their zone via `parent_code` (CR-012 pattern),
		// so municipality_zone must already be resolved when this one is built.
		type: 'community',
		parent_type: 'municipality_zone',
		items: [
			{ key: 'ban_thung', label: 'ชุมชนบ้านทุ่ง', is_default: true, parent_key: 'zone_1' },
			{ key: 'rim_klong', label: 'ชุมชนริมคลอง', parent_key: 'zone_1' },
			{ key: 'na_mueang', label: 'ชุมชนหน้าเมือง', parent_key: 'zone_2' },
			{ key: 'suan_luang', label: 'ชุมชนสวนหลวง', parent_key: 'zone_3' }
		]
	}
];

async function seedMasterData(): Promise<MasterLookup> {
	await ensureDb('registry');
	const ts = now();
	const master = {} as MasterLookup;

	for (const def of MASTER_DATA_DEFS) {
		const id = masterDocId(def.type);
		const { status: getStatus, data } = await couchReq(
			'GET',
			`/registry/${encodeURIComponent(id)}`
		);
		const existing = getStatus === 200 ? (data as MasterData) : null;
		// Reuse the persisted code for a label we already seeded — a re-run must
		// not orphan `special_needs` / `community` refs on existing people docs.
		const persistedByLabel = new Map((existing?.items ?? []).map((i) => [i.label, i]));

		const resolved: Record<string, MasterDataItem> = {};
		const seeded: MasterDataItem[] = def.items.map((d) => {
			const item: MasterDataItem = {
				code: persistedByLabel.get(d.label)?.code ?? itemCode(),
				label: d.label,
				is_default: d.is_default ?? false,
				status: 'active',
				...(d.parent_key ? { parent_code: masterCode(master, def.parent_type!, d.parent_key) } : {})
			};
			resolved[d.key] = item;
			return item;
		});
		master[def.type] = resolved;

		// Keep items an operator added through the config UI — the seed owns its own
		// labels, not the whole list. Seeded items come first so `enforceOneDefault`
		// resolves the default in the seed's favour.
		const seededLabels = new Set(def.items.map((d) => d.label));
		const extras = (existing?.items ?? []).filter((i) => !seededLabels.has(i.label));
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

/**
 * `config:app` — the app-wide singleton (schema.md §3.2).
 *
 * Seeded at the documented defaults so the document exists to be edited. Readers fall
 * back to the same values when it is missing, so seeding changes no behaviour; it just
 * means an operator has somewhere to change the donation TTL without creating a document
 * by hand.
 */
async function seedAppConfig(): Promise<void> {
	await ensureDb('registry');
	const ts = now();
	const id = APP_CONFIG_DOC_ID;
	const { status: getStatus } = await couchReq('GET', `/registry/${encodeURIComponent(id)}`);
	if (getStatus === 200) {
		// Never overwrite: this is operator-tuned configuration, not fixture data.
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

// ─── seedCatalog ──────────────────────────────────────────────────────────────

async function seedCatalog(): Promise<void> {
	await ensureDb('catalog');
	await setSecurity('catalog', {
		admins: { names: [], roles: ['system_admin'] },
		members: {
			names: [],
			roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff']
		}
	});

	// Deploy validate_doc_update to catalog DB to enforce read-only for non-SA roles
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
  throw({ forbidden: 'Only System Admins can write to the catalog database.' });
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
	// item_master docs (catalog schema_v 3) — BOM recipes reference these, and the
	// kitchen resolves each to real stock (supply_item) by matching name AND unit
	// (resolveItemMasterStock). rice/egg/vegetable names+units match the
	// supply_items above, so BOM plans from them เบิก against real stock; the
	// canned-fish master has no supply_item counterpart, so a recipe using it
	// stays "unresolved" (demonstrates the block-on-unlinked-ingredient path).
	const itemMasterBase = {
		conversions: [],
		distribution_type: 'consumable',
		target_audience_type: 'all',
		target_restrictions: {},
		is_default: false
	} as const;
	const itemMasters = [
		catalogDoc(
			'item_master:rice',
			'item_master',
			{ name: 'ข้าวสาร', category: 'food', base_unit: 'kg', ...itemMasterBase },
			3
		),
		catalogDoc(
			'item_master:egg',
			'item_master',
			{ name: 'ไข่ไก่', category: 'food', base_unit: 'piece', ...itemMasterBase },
			3
		),
		catalogDoc(
			'item_master:vegetable',
			'item_master',
			{ name: 'ผักรวม', category: 'food', base_unit: 'kg', ...itemMasterBase },
			3
		),
		catalogDoc(
			'item_master:canned-fish',
			'item_master',
			{ name: 'ปลากระป๋อง', category: 'food', base_unit: 'can', ...itemMasterBase },
			3
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
				],
				is_default: false
			},
			3
		),
		catalogDoc(
			'recipe:congee',
			'recipe',
			{
				label: 'ข้าวต้ม',
				standard_portions: '1',
				standard_duration_hours: '1',
				ingredients: [{ item_master_id: 'item_master:rice', quantity: '0.15', uom: 'kg' }],
				is_default: false
			},
			3
		),
		// Uses canned-fish (no matching supply_item) → BOM stays unresolved, so the
		// plan can't be confirmed/withdrawn until the name is linked (demo step 2).
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
				],
				is_default: false
			},
			3
		)
	];

	for (const doc of [...items, ...itemMasters, ...recipes]) await putDoc('catalog', doc);
	console.log(
		`  ✓ catalog: ${items.length} supply items, ${itemMasters.length} item masters, ${recipes.length} recipes`
	);

	await deployCatalogMangoIndexes('catalog');
}

async function seedCatalogSopRatios(): Promise<void> {
	await ensureDb('catalog');

	// Idempotent check: check if the Sphere Baseline master profile already exists in catalog DB
	// We use the deterministic ID 'master_sphere_baseline' to do an O(1) direct document lookup
	// NOTE: If the name "Sphere Baseline" is changed in the future, remember to update this deterministicId
	// to prevent the script from accidentally creating a duplicate master profile.
	const deterministicId = 'master_sphere_baseline';
	const fullDocId = `sop_profile:${deterministicId}`;
	const { status, data } = await couchReq('GET', `/catalog/${encodeURIComponent(fullDocId)}`);

	let existingRev: string | undefined = undefined;

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

	// Override standard ULIDs with deterministic IDs for idempotency scan boundary
	profile._id = fullDocId;
	if (existingRev) {
		profile._rev = existingRev;
	}
	audit.target_id = fullDocId;
	audit._id = `audit:seed_sphere_baseline`;

	await bulkDocs('catalog', [profile, audit]);
	console.log('  ✓ catalog: SOP Ratio "Sphere Baseline" seeded (upgraded if stale)');
}

async function deployShelterAccessDesign(db: string, shelterCode: string): Promise<void> {
	const ddocId = '_design/access';
	const { status: getStatus, data: existingDdoc } = await couchReq(
		'GET',
		`/${db}/${encodeURIComponent(ddocId)}`
	);
	const rev = getStatus === 200 ? (existingDdoc as { _rev: string })._rev : undefined;
	const { status, data } = await couchReq('PUT', `/${db}/${encodeURIComponent(ddocId)}`, {
		_id: ddocId,
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: buildValidateDocUpdate(shelterCode)
	});
	if (status >= 400) {
		const detail = (data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot deploy _design/access to "${db}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	console.log(`  ✓ ${db}: _design/access deployed (referral whitelist)`);
}

async function deployMangoIndexes(db: string): Promise<void> {
	for (const def of REFERRAL_MANGO_INDEXES) {
		const { status, data } = await couchReq('POST', `/${db}/_index`, def);
		if (status >= 400) {
			const detail = (data as { reason?: string; error?: string } | null) ?? {};
			throw new Error(
				`Cannot deploy Mango index "${def.name}" to "${db}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
	}
	console.log(`  ✓ ${db}: Mango indexes for referral deployed`);
}

async function listRegistryShelterCodes(): Promise<string[]> {
	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (status === 404) {
		throw new Error('Cannot provision shelter databases: registry DB does not exist');
	}
	if (status >= 400) {
		const detail = (data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot read registry for shelter provisioning (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}

	const rows =
		(data as { rows?: { id?: string; doc?: { type?: string; code?: unknown } }[] })?.rows ?? [];
	const codes = new Set<string>();

	for (const row of rows) {
		if (!row.id?.startsWith('shelter:') || row.doc?.type !== 'shelter') continue;
		const parsed = shelterCodeSchema.safeParse(row.doc.code);
		if (!parsed.success) {
			console.warn(`  ⚠ registry: skipping invalid shelter code "${String(row.doc.code)}"`);
			continue;
		}
		codes.add(parsed.data);
	}

	return [...codes].sort();
}

async function provisionShelterDb(shelterCode: string): Promise<void> {
	const code = shelterCodeSchema.parse(shelterCode);
	const db = shelterDbName(code);
	await ensureDb(db);
	await setSecurity(db, {
		admins: { names: [], roles: ['system_admin'] },
		members: { names: [], roles: [`shelter:${code}`] }
	});
	await deployShelterViewsFn(db, (path, method, body) => couchReq(method, path, body));
	await deployShelterAccessDesign(db, code);
	await deployMangoIndexes(db);
}

async function provisionRegistryShelterDbs(): Promise<void> {
	const codes = await listRegistryShelterCodes();
	if (codes.length === 0) {
		console.log('  ⚠ registry: no shelter masters found to provision');
		return;
	}

	for (const shelterCode of codes) {
		console.log(`  → provisioning ${shelterCode} (${shelterDbName(shelterCode)})`);
		await provisionShelterDb(shelterCode);
	}
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
	console.log(`  ✓ ${db}: Mango indexes for sop_profile and audit queries deployed`);
}

// ─── seedShelter ──────────────────────────────────────────────────────────────

async function seedShelter(master: MasterLookup): Promise<void> {
	// Master-data codes this shelter's people docs reference. `community` must sit
	// under the household's `municipality_zone` — the master items are linked by
	// `parent_code`, so a mismatched pair would render as an orphan in the form.
	const zone = (key: string) => masterCode(master, 'municipality_zone', key);
	const community = (key: string) => masterCode(master, 'community', key);
	const vg = (...keys: string[]) => masterCodes(master, 'vulnerable_group', ...keys);
	const health = (...keys: string[]) => masterLabels(master, 'health_condition', ...keys);

	// — households ——————————————————————————————————————————————————————————————
	const hhInputs: HouseholdInput[] = [
		{
			label: 'ครอบครัวใจดี',
			municipality_zone: zone('zone_1'),
			community: community('ban_thung'),
			head_evacuee_id: null,
			pets: [],
			notes: 'ครอบครัวใหญ่ 4 คน'
		},
		{
			label: 'ครอบครัวสุขสาย',
			municipality_zone: zone('zone_1'),
			community: community('rim_klong'),
			head_evacuee_id: null,
			// PetGroup.species is a fixed domain enum, not a master_data code — the
			// pet_types master feeds the config screens only.
			pets: [{ species: 'dog', count: 1 }]
		},
		{
			label: 'ครอบครัวรักสงบ',
			municipality_zone: zone('zone_2'),
			community: community('na_mueang'),
			head_evacuee_id: null,
			pets: []
		}
	];
	const [hh1, hh2, hh3] = hhInputs.map((h) => createHousehold(h, ctx));

	// — evacuees ————————————————————————————————————————————————————————————————
	const evacueeInputs: EvacueeInput[] = [
		// hh1 — family of 4 (สมชาย household)
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0811111111',
			birth_year: 2498,
			religion: 'buddhist',
			special_needs: vg('elderly'),
			household_id: hh1._id,
			registered_via: 'import'
		},
		{
			first_name: 'สมหญิง',
			last_name: 'ใจดี',
			gender: 'female',
			phone: '0812222222',
			birth_year: 2501,
			religion: 'buddhist',
			special_needs: vg('elderly'),
			household_id: hh1._id,
			registered_via: 'import'
		},
		{
			first_name: 'ประเสริฐ',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0813333333',
			birth_year: 2533,
			religion: 'buddhist',
			special_needs: [],
			household_id: hh1._id,
			registered_via: 'import'
		},
		{
			first_name: 'ประภา',
			last_name: 'ใจดี',
			gender: 'female',
			phone: '0814444444',
			birth_year: 2536,
			religion: 'buddhist',
			special_needs: vg('pregnant'),
			household_id: hh1._id,
			registered_via: 'import',
			emergency_contact: { name: 'ประเสริฐ ใจดี', phone: '0813333333', relation: 'สามี' }
		},
		// hh2 — small family with infant (มาลี household)
		{
			first_name: 'มาลี',
			last_name: 'สุขสาย',
			gender: 'female',
			phone: null,
			birth_year: 2531,
			religion: 'buddhist',
			special_needs: [],
			household_id: hh2._id,
			registered_via: 'import'
		},
		{
			first_name: 'สมพล',
			last_name: 'สุขสาย',
			gender: 'male',
			phone: '0815555555',
			birth_year: 2528,
			religion: 'buddhist',
			special_needs: [],
			household_id: hh2._id,
			registered_via: 'import'
		},
		{
			first_name: 'น้องดาว',
			last_name: 'สุขสาย',
			gender: 'female',
			phone: null,
			birth_year: 2567,
			religion: 'buddhist',
			special_needs: vg('infant'),
			household_id: hh2._id,
			registered_via: 'import'
		},
		// hh3 — Muslim family (วิชัย household)
		{
			first_name: 'วิชัย',
			last_name: 'รักสงบ',
			gender: 'male',
			phone: '0816666666',
			birth_year: 2515,
			religion: 'muslim',
			special_needs: [],
			household_id: hh3._id,
			registered_via: 'import'
		},
		{
			first_name: 'ฟาตีเมาะ',
			last_name: 'รักสงบ',
			gender: 'female',
			phone: '0817777777',
			birth_year: 2518,
			religion: 'muslim',
			special_needs: vg('chronic_illness'),
			household_id: hh3._id,
			registered_via: 'import',
			emergency_contact: { name: 'วิชัย รักสงบ', phone: '0816666666', relation: 'สามี' }
		},
		{
			first_name: 'อาเซ็ม',
			last_name: 'รักสงบ',
			gender: 'male',
			phone: null,
			birth_year: 2555,
			religion: 'muslim',
			special_needs: [],
			household_id: hh3._id,
			registered_via: 'import'
		}
	];
	const evacuees = evacueeInputs.map((e) => createEvacuee(e, ctx));

	// — movements (check_in for every evacuee) —————————————————————————————————
	const movementInputs: MovementInput[] = evacuees.map((e) => ({
		evacuee_id: e._id,
		action: 'check_in' as const,
		zone: 'Z1'
	}));
	const movements = movementInputs.map((m) => createMovement(m, ctx));

	// Apply check-in to each evacuee's current_stay snapshot.
	const checkedInEvacuees = evacuees.map((e, i) => applyMovementToStay(e, movements[i]));

	// — medical records ————————————————————————————————————————————————————————
	// `conditions` / `allergies` are free text on the doc (no code field), so these
	// carry the health_condition master LABELS — the values a staff member would
	// get by picking from the configured list rather than inventing wording.
	const medicalInputs: MedicalInput[] = [
		{
			evacuee_id: evacuees[0]._id,
			blood_group: 'O',
			conditions: health('hypertension'),
			medications: ['แอมโลดิปีน 5mg'],
			allergies: [],
			track: 'fast_track'
		},
		{
			evacuee_id: evacuees[1]._id,
			blood_group: 'A',
			conditions: health('diabetes'),
			medications: ['เมตฟอร์มิน 500mg'],
			allergies: [],
			track: 'fast_track'
		},
		{
			evacuee_id: evacuees[3]._id,
			blood_group: 'A',
			conditions: [],
			medications: ['วิตามินก่อนคลอด'],
			allergies: [],
			track: 'fast_track',
			notes: 'ตั้งครรภ์ 28 สัปดาห์'
		},
		{
			evacuee_id: evacuees[8]._id,
			blood_group: 'B',
			conditions: health('asthma'),
			medications: ['ซัลบูทามอล'],
			allergies: health('sulfa_allergy'),
			track: 'fast_track'
		}
	];
	const medicals = medicalInputs.map((m) => createMedical(m, ctx));

	// — screenings ————————————————————————————————————————————————————————————
	const screeningInputs: ScreeningInput[] = [
		{
			evacuee_id: evacuees[0]._id,
			symptoms: ['ปวดศีรษะ'],
			temperature_c: 37.2,
			track: 'normal',
			needs_referral: false
		},
		{
			evacuee_id: evacuees[3]._id,
			symptoms: ['ปวดหลัง', 'บวมเท้า'],
			temperature_c: 37.0,
			track: 'fast_track',
			needs_referral: true,
			notes: 'ควรพบสูติแพทย์'
		},
		{
			evacuee_id: evacuees[8]._id,
			symptoms: ['หายใจหอบ', 'แน่นหน้าอก'],
			temperature_c: 37.5,
			track: 'fast_track',
			needs_referral: true
		},
		{
			evacuee_id: evacuees[5]._id,
			symptoms: [],
			temperature_c: 36.7,
			track: 'normal',
			needs_referral: false
		}
	];
	const screenings = screeningInputs.map((s) => createScreening(s, ctx));

	// — stock ledger ——————————————————————————————————————————————————————————
	const stockInputs: StockLedgerInput[] = [
		{
			item_id: ITEM.rice,
			qty: code === SH001_CODE ? '200' : '100',
			unit: 'kg',
			reason: 'receive',
			ref_id: null
		},
		{
			item_id: ITEM.water,
			qty: code === SH001_CODE ? '500' : '300',
			unit: 'bottle',
			reason: 'receive',
			ref_id: null
		},
		{ item_id: ITEM.paracetamol, qty: '1000', unit: 'tablet', reason: 'receive', ref_id: null },
		{ item_id: ITEM.soap, qty: '150', unit: 'bar', reason: 'receive', ref_id: null },
		{ item_id: ITEM.blanket, qty: '80', unit: 'piece', reason: 'receive', ref_id: null },
		{ item_id: ITEM.egg, qty: '2000', unit: 'piece', reason: 'receive', ref_id: null },
		{ item_id: ITEM.vegetable, qty: '150', unit: 'kg', reason: 'receive', ref_id: null },
		{ item_id: ITEM.rice, qty: '-30', unit: 'kg', reason: 'distribute', ref_id: null },
		{ item_id: ITEM.water, qty: '-100', unit: 'bottle', reason: 'distribute', ref_id: null }
	];
	const stockEntries = stockInputs.map((s) => createStockLedger(s, ctx));

	// — donation campaigns ————————————————————————————————————————————————————
	const campaignInputs: CampaignInput[] = [
		{
			title: 'รับบริจาคอาหารและน้ำดื่ม',
			needs: [
				{ item_id: ITEM.rice, qty_target: code === SH001_CODE ? '500' : '300', unit: 'kg' },
				{ item_id: ITEM.water, qty_target: code === SH001_CODE ? '1000' : '500', unit: 'bottle' }
			],
			notes: 'เปิดรับบริจาคเพื่อผู้ประสบภัยน้ำท่วม'
		},
		{
			title: 'รับบริจาคของใช้ส่วนตัว',
			needs: [
				{ item_id: ITEM.soap, qty_target: '200', unit: 'bar' },
				{ item_id: ITEM.blanket, qty_target: '100', unit: 'piece' }
			]
		}
	];
	const campaigns = campaignInputs.map((c) => createCampaign(c, ctx));

	// — donations ——————————————————————————————————————————————————————————————
	const donationInputs: WalkInDonationInput[] = [
		{
			donor: { name: 'บริษัท ซีพีเอฟ จำกัด', phone: '022222222', phone_hash: 'mock-hash-cpf' },
			kind: 'items',
			items: [{ item_id: ITEM.rice, qty: code === SH001_CODE ? '50' : '20', unit: 'kg' }],
			campaign_id: campaigns[0]._id,
			tracking_token_hash: 'mock-track-001'
		},
		{
			donor: { name: 'วัดท่าสะอ้าน', phone: null, phone_hash: 'mock-hash-wat' },
			kind: 'items',
			items: [
				{ item_id: ITEM.water, qty: code === SH001_CODE ? '100' : '50', unit: 'bottle' },
				{ item_id: ITEM.blanket, qty: '20', unit: 'piece' }
			],
			campaign_id: campaigns[0]._id,
			tracking_token_hash: 'mock-track-002'
		},
		{
			donor: { name: 'ทดสอบ ระบบ', phone: '0899999999', phone_hash: 'mock-hash-test' },
			kind: 'money',
			amount_thb: 5000,
			campaign_id: null,
			tracking_token_hash: 'mock-track-003'
		}
	];
	const donations = donationInputs.map((d) => createWalkInDonation(d, ctx));

	// — purchases (CR-032) ————————————————————————————————————————————————————
	// Two-step flow: the doc is declared first, the count is keyed separately. The
	// second purchase is left unkeyed so both badge states show up in the UI.
	const purchaseInputs: PurchaseInput[] = [
		{
			vendor: 'บริษัท สยามค้าส่ง จำกัด',
			po_ref: 'PO-2569-0001',
			items: [
				{ item_id: ITEM.rice, qty: '100', unit: 'kg' },
				{ item_id: ITEM.soap, qty: '60', unit: 'bar' }
			],
			note: 'จัดซื้อรอบเร่งด่วนสัปดาห์แรก'
		},
		{
			vendor: 'ร้านค้าสหกรณ์ชุมชน',
			items: [{ item_id: ITEM.blanket, qty: '40', unit: 'piece' }]
		}
	];
	const purchases = purchaseInputs.map((p) => createPurchase(p, ctx));

	// Partial receipt against the first purchase — rice arrived, soap has not.
	const purchaseReceipts = keyPurchaseReceipt(
		purchases[0],
		[{ item_id: ITEM.rice, qty: '100', unit: 'kg' }],
		ctx
	);

	// — bulk insert ——————————————————————————————————————————————————————————
	const allDocs = [
		...hhInputs.map((_, i) => [hh1, hh2, hh3][i]),
		...checkedInEvacuees,
		...movements,
		...medicals,
		...screenings,
		...stockEntries,
		...campaigns,
		...donations,
		...purchases,
		...purchaseReceipts
	];
	await bulkDocs(dbName, allDocs);

	console.log(
		`  ✓ ${dbName}: 3 households, ${evacuees.length} evacuees, ${movements.length} movements`
	);
	console.log(`  ✓ ${dbName}: ${medicals.length} medicals, ${screenings.length} screenings`);
	console.log(
		`  ✓ ${dbName}: ${stockEntries.length} stock entries, ${campaigns.length} campaigns, ${donations.length} donations`
	);
	console.log(
		`  ✓ ${dbName}: ${purchases.length} purchases, ${purchaseReceipts.length} purchase receipt rows`
	);
}

async function seedShelter2(master: MasterLookup): Promise<void> {
	const { status, data } = await couchReq('GET', `/${SHELTER_DB_2}/_all_docs?limit=1`);
	if (status === 200 && (data as { rows?: unknown[] }).rows?.length) {
		console.log(`  ✓ ${SHELTER_DB_2}: already seeded, skipping`);
		return;
	}

	// — households ——————————————————————————————————————————————————————————————
	const hhInputs: HouseholdInput[] = [
		{
			label: 'ครอบครัวปัตตานี',
			municipality_zone: masterCode(master, 'municipality_zone', 'zone_1'),
			community: masterCode(master, 'community', 'ban_thung'),
			head_evacuee_id: null,
			pets: [],
			notes: 'ตัวอย่าง SH002'
		}
	];
	const [hh1] = hhInputs.map((h) => createHousehold(h, CTX_2));

	// — evacuees ————————————————————————————————————————————————————————————————
	// `pregnant` is on SH002's supported_vulnerable_groups, so the chip resolves
	// in registration for this shelter too.
	const evacueeInputs: EvacueeInput[] = [
		{
			first_name: 'ดานียา',
			last_name: 'มานะ',
			gender: 'female',
			phone: '0899998888',
			birth_year: 2538,
			religion: 'muslim',
			special_needs: masterCodes(master, 'vulnerable_group', 'pregnant'),
			household_id: hh1._id,
			registered_via: 'import'
		}
	];
	const evacuees = evacueeInputs.map((e) => createEvacuee(e, CTX_2));

	const movementInputs: MovementInput[] = evacuees.map((e) => ({
		evacuee_id: e._id,
		action: 'check_in' as const,
		zone: 'Z1'
	}));
	const movements = movementInputs.map((m) => createMovement(m, CTX_2));
	const checkedInEvacuees = evacuees.map((e, i) => applyMovementToStay(e, movements[i]));

	const stockInputs: StockLedgerInput[] = [
		{ item_id: ITEM.water, qty: '100', unit: 'bottle', reason: 'receive', ref_id: null }
	];
	const stockEntries = stockInputs.map((s) => createStockLedger(s, CTX_2));

	const allDocs = [hh1, ...checkedInEvacuees, ...movements, ...stockEntries];
	await bulkDocs(SHELTER_DB_2, allDocs);

	console.log(`  ✓ ${SHELTER_DB_2}: 1 household, 1 evacuee, 1 movement, 1 stock entry`);
}

// ─── seedDashboardData ────────────────────────────────────────────────────────
async function seedDashboardData(master: MasterLookup): Promise<void> {
	await ensureDb(SHELTER_DB);

	// Check if already seeded by looking specifically for our generated mock docs
	const { status, data } = await couchReq('GET', `/${SHELTER_DB}/_all_docs?limit=200`);
	if (status === 200) {
		const rows = (data as { rows?: { id: string }[] }).rows ?? [];
		const mockCount = rows.filter((r) => r.id.startsWith('evacuee:seed-genname')).length;
		if (mockCount > 10) {
			console.log(
				`  ✓ ${SHELTER_DB}: dashboard data already seeded (${mockCount} mock evacuees found), skipping`
			);
			return;
		}
	}

	const COUNTRIES = [
		'THAILAND',
		'MYANMAR',
		'LAOS',
		'CAMBODIA',
		'VIETNAM',
		'MALAYSIA',
		'SINGAPORE',
		'CHINA',
		'JAPAN',
		'SOUTH KOREA',
		'PHILIPPINES',
		'INDONESIA',
		'INDIA',
		'UNKNOWN'
	];
	const STATUSES = [
		'pre_registered',
		'active',
		'active',
		'temporary_leave',
		'transferred',
		'checked_out',
		'deceased'
	] as const;
	const CURRENT_YEAR = new Date().getFullYear();

	// Age bucket → vulnerable_group master code, so the dashboard's vulnerable
	// counts and the profile chips resolve against the seeded master list. Every
	// code used here is on SH001's supported_vulnerable_groups (see REGISTRY_SHELTERS).
	const SPECIAL_NEEDS_BY_AGE_BUCKET: Record<string, string[]> = {
		'0-4': masterCodes(master, 'vulnerable_group', 'infant'),
		'5-11': masterCodes(master, 'vulnerable_group', 'young_child'),
		'12-17': [],
		'18-59': [],
		'60+': masterCodes(master, 'vulnerable_group', 'elderly')
	};

	function rnd(min: number, max: number) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	function randomDatePast30Days() {
		const date = new Date();
		date.setDate(date.getDate() - rnd(0, 30));
		return date.toISOString();
	}

	const NUM_DOCS = 100;
	const docs: PeopleDoc[] = [];
	const stats = {
		status: {} as Record<string, number>,
		country: {} as Record<string, number>,
		age: { '0-4': 0, '5-11': 0, '12-17': 0, '18-59': 0, '60+': 0 } as Record<string, number>
	};

	for (let i = 0; i < NUM_DOCS; i++) {
		const birth_year = CURRENT_YEAR + 543 - rnd(0, 80);
		const age = CURRENT_YEAR + 543 - birth_year;
		let ageBucket = '60+';
		if (age <= 4) ageBucket = '0-4';
		else if (age <= 11) ageBucket = '5-11';
		else if (age <= 17) ageBucket = '12-17';
		else if (age <= 59) ageBucket = '18-59';

		const country = COUNTRIES[rnd(0, COUNTRIES.length - 1)];
		const status = STATUSES[rnd(0, STATUSES.length - 1)];

		stats.status[status] = (stats.status[status] || 0) + 1;
		stats.country[country] = (stats.country[country] || 0) + 1;
		stats.age[ageBucket] = (stats.age[ageBucket] || 0) + 1;
		const input: EvacueeInput = {
			first_name: `GenName${i}`,
			last_name: `GenSurname${i}`,
			gender: i % 2 === 0 ? 'male' : 'female',
			phone: null,
			birth_year,
			special_needs: SPECIAL_NEEDS_BY_AGE_BUCKET[ageBucket],
			registered_via: 'import'
		};

		const doc = createEvacuee(input, CTX);

		// Force override for views & identification
		doc._id = `evacuee:seed-genname-${i}`;
		(doc as Evacuee & { country: string }).country = country;
		doc.current_stay.status = status;

		const createdDate = randomDatePast30Days();
		doc.created_at = createdDate;
		doc.updated_at = createdDate;

		docs.push(doc);

		// Generate check-in movement for everyone
		const checkInMove = createMovement(
			{
				evacuee_id: doc._id,
				action: 'check_in',
				zone: 'Z1'
			},
			CTX
		);
		checkInMove._id = `movement:seed-genname-${i}-in`;
		checkInMove.occurred_at = createdDate;
		docs.push(checkInMove);

		// Generate check-out or transfer-out if applicable
		if (status === 'checked_out' || status === 'transferred') {
			const outDate = new Date(createdDate);
			outDate.setDate(outDate.getDate() + rnd(1, 5));
			if (outDate > new Date()) {
				outDate.setTime(new Date().getTime()); // Clamp to today
			}

			const action = status === 'checked_out' ? 'check_out' : 'transfer_out';
			const outMove = createMovement(
				{
					evacuee_id: doc._id,
					action
				},
				CTX
			);
			outMove._id = `movement:seed-genname-${i}-out`;
			outMove.occurred_at = outDate.toISOString();
			docs.push(outMove);
		}
	}

	await bulkDocs(SHELTER_DB, docs);
	console.log(`\n  --- 📊 Dashboard Seed Stats (${NUM_DOCS} docs) ---`);
	console.log(`  [Status] :`, stats.status);
	console.log(`  [Country]:`, stats.country);
	console.log(`  [Age]    :`, stats.age);
	console.log(`  --------------------------------------------\n`);
}

// ─── seedDailyCalc ──────────────────────────────────────────────────────────────
//
// Seed-only fixture for the T-32 resource dashboard. Production R3 calculation is on-demand
// through DailyCalcRemoteRepository; this script does not implement or stand in for a scheduler.
//
// The need/have/gap/status numbers come from the REAL engine (`calculateResources`,
// FORMULA_V) fed the active master SOP ratios, so the persisted shape matches production exactly.
// Historical occupancy remains a deterministic mock because this seed does not have historical
// occupancy input. Stock and shelter `have` values are read from persisted sources through the
// CR-042 ratio-to-source map. This does NOT replace the real worker; when it lands, output shape
// is already identical.

const DAILY_CALC_DAYS = 14;

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

interface CouchDocRow {
	doc?: unknown;
}

interface CouchDocsResponse {
	rows?: CouchDocRow[];
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readSeedStockBalance(): Promise<Map<string, string>> {
	const startkey = encodeURIComponent(JSON.stringify('stock_ledger:'));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd('stock_ledger:')));
	const { status, data } = await couchReq(
		'GET',
		`/${SHELTER_DB}/_all_docs?include_docs=true&startkey=${startkey}&endkey=${endkey}`
	);
	if (status !== 200) {
		throw new Error(`Cannot read stock ledger from "${SHELTER_DB}" (HTTP ${status})`);
	}

	const rows = (data as CouchDocsResponse).rows ?? [];
	const ledger = rows.map((row, index) => {
		if (row.doc === undefined) throw new Error(`Missing stock_ledger document at row ${index}`);
		try {
			return parseStockLedger(row.doc);
		} catch (error) {
			throw new Error(`Invalid persisted stock_ledger at row ${index}: ${String(error)}`, {
				cause: error
			});
		}
	});
	return stockBalance(ledger);
}

async function readSeedShelterSource(): Promise<ShelterHaveSource> {
	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (status !== 200) {
		throw new Error(`Cannot read shelter registry (HTTP ${status})`);
	}

	const rows = (data as CouchDocsResponse).rows ?? [];
	const shelter = rows
		.map((row) => row.doc)
		.find((doc): doc is Record<string, unknown> => {
			if (!doc || typeof doc !== 'object') return false;
			const candidate = doc as Record<string, unknown>;
			return candidate.type === 'shelter' && candidate.code === SHELTER_CODE;
		});
	if (!shelter) {
		throw new Error(`Cannot find shelter ${SHELTER_CODE} in registry`);
	}

	const facilities =
		shelter.facilities && typeof shelter.facilities === 'object'
			? (shelter.facilities as Record<string, unknown>)
			: {};

	return {
		area_m2: finiteNumber(shelter.area_m2),
		facilities: {
			water_points: finiteNumber(facilities.water_points),
			showers: finiteNumber(facilities.showers),
			toilets_female: finiteNumber(facilities.toilets_female),
			toilets_male: finiteNumber(facilities.toilets_male)
		}
	};
}

async function seedDailyCalc(): Promise<void> {
	await ensureDb(SHELTER_DB);

	// The persisted master profile is the only source of truth for seeded daily_calc snapshots.
	const { status, data } = await couchReq(
		'GET',
		`/catalog/${encodeURIComponent('sop_profile:master_sphere_baseline')}`
	);
	if (status !== 200) {
		throw new Error(`Cannot read persisted master SOP profile (HTTP ${status})`);
	}
	const master = sopMasterSchema.parse(data);
	if (!master.active) {
		throw new Error('Persisted master SOP profile is not active');
	}
	const ratios: Record<SopRatioKey, string> = master.ratios;
	const sopVersion = master.version;
	const [stock, shelter] = await Promise.all([readSeedStockBalance(), readSeedShelterSource()]);

	const today = new Date();
	const records: unknown[] = [];

	for (let back = DAILY_CALC_DAYS - 1; back >= 0; back--) {
		const day = new Date(today);
		day.setDate(day.getDate() - back);
		const date = isoDay(day);
		const asOf = `${date}T09:00:00.000Z`;

		// Mock occupancy — a gentle deterministic wave (historical headcount is unknowable).
		const phase = ((DAILY_CALC_DAYS - 1 - back) / DAILY_CALC_DAYS) * Math.PI * 2;
		const jitter = ((back * 7) % 11) - 5;
		const occupancy = Math.max(0, Math.round(120 + 25 * Math.sin(phase) + jitter));

		const resources: ResourceInput[] = [];
		const ratioSnapshot: Record<string, string> = {};
		const stockSnapshot: Record<string, string | null> = {};

		for (const key of Object.keys(ratios) as SopRatioKey[]) {
			const ratioStr = ratios[key];
			const kind = SOP_RATIO_KIND[key];
			const have = resolveHave(key, { stock, shelter });
			resources.push({ key, kind, ratio: ratioStr, have });
			ratioSnapshot[key] = ratioStr;
			stockSnapshot[key] = have;
		}

		// REAL engine — need/gap/status computed exactly as production would.
		const results = calculateResources({ occupancy, as_of: asOf, resources });

		const body = dailyCalcDocSchema.parse({
			formula_v: FORMULA_V,
			sop_profile_version: sopVersion,
			ratio_source: 'master',
			sop_override_id: null,
			sop_override_version: null,
			ratio_snapshot: ratioSnapshot,
			occupancy_snapshot: occupancy,
			as_of: asOf,
			stock_snapshot: stockSnapshot,
			results
		});

		const record = makeDoc('daily_calc', DAILY_CALC_SCHEMA_VERSION, body, CTX, date);
		// Validate the complete persisted shape before bulk write: domain body, envelope, canonical
		// key set, provenance, and semantic row invariants must all pass for every snapshot.
		parseDailyCalcRecord(record);
		records.push(record);
	}

	try {
		await bulkDocs(SHELTER_DB, records, { allowConflicts: false });
	} catch (error) {
		throw new Error(
			`daily_calc seed write failed. Existing deterministic snapshots must be wiped before reseeding: ${String(error)}`,
			{ cause: error }
		);
	}
	console.log(
		`  ✓ ${SHELTER_DB}: ${records.length} daily_calc snapshots seeded (CR-042 have map, mock historical occupancy, real engine ${FORMULA_V})`
	);
}

// ─── deleteDashboardData ──────────────────────────────────────────────────────

async function deleteDashboardData(): Promise<void> {
	await ensureDb(SHELTER_DB);
	console.log(`Searching for dashboard test data in ${SHELTER_DB}...`);

	const keys = Array.from({ length: 100 }, (_, i) => `evacuee:seed-genname-${i}`);
	const { status, data } = await couchReq('POST', `/${SHELTER_DB}/_all_docs?include_docs=true`, {
		keys
	});
	if (status !== 200) {
		console.log(`Failed to fetch docs: HTTP ${status}`);
		return;
	}

	const rows = (
		data as { rows: { doc: { type?: string; first_name?: string } & Record<string, unknown> }[] }
	).rows;
	const toDelete = rows
		.filter((r) => r.doc && r.doc._id)
		.map((r) => ({ ...r.doc, _deleted: true }));

	// Also find and delete movements generated by seed
	const movementKeys = [];
	for (let i = 0; i < 100; i++) {
		movementKeys.push(`movement:seed-genname-${i}-in`);
		movementKeys.push(`movement:seed-genname-${i}-out`);
	}
	const { status: mStatus, data: mData } = await couchReq(
		'POST',
		`/${SHELTER_DB}/_all_docs?include_docs=true`,
		{
			keys: movementKeys
		}
	);
	if (mStatus === 200) {
		const mRows = (mData as { rows: { doc: { type?: string } & Record<string, unknown> }[] }).rows;
		const movesToDelete = mRows
			.filter((r) => r.doc && r.doc._id)
			.map((r) => ({ ...r.doc, _deleted: true }));
		toDelete.push(...movesToDelete);
	}

	// Also find and delete daily_calc snapshots produced by this seed script — bounded range scan.
	// Upper bound ';' (0x3B) sorts just after ':' (0x3A), covering every `daily_calc:*` id (ASCII-only).
	const dcStart = encodeURIComponent(JSON.stringify('daily_calc:'));
	const dcEnd = encodeURIComponent(JSON.stringify('daily_calc;'));
	const { status: dcStatus, data: dcData } = await couchReq(
		'GET',
		`/${SHELTER_DB}/_all_docs?include_docs=true&startkey=${dcStart}&endkey=${dcEnd}`
	);
	if (dcStatus === 200) {
		const dcRows = (dcData as { rows: { doc: { type?: string } & Record<string, unknown> }[] })
			.rows;
		const dcToDelete = dcRows
			.filter((r) => r.doc && r.doc._id)
			.map((r) => ({ ...r.doc, _deleted: true }));
		toDelete.push(...dcToDelete);
	}

	if (toDelete.length === 0) {
		console.log(`  ✓ No dashboard test data found to delete.`);
		return;
	}

	await bulkDocs(SHELTER_DB, toDelete);
	console.log(`  ✓ Deleted ${toDelete.length} dashboard test documents.`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
	if (process.argv.includes('--delete-dashboard')) {
		await deleteDashboardData();
		process.exit(0);
	}

	const displayUrl = rawCouchUrl.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
	console.log(`\nSeeding mock data → ${displayUrl}\n`);
	try {
		await seedUsers();
		// Master data first: the shelter masters and every people doc below persist
		// its item codes, and seedMasterData is what resolves key → code.
		const master = await seedMasterData();
		await seedAppConfig();
		await seedRegistry(master);
		await provisionRegistryShelterDbs();
		await seedCatalog();
		await seedCatalogSopRatios();
		await seedShelter(master);
		await seedShelter2(master);
		await seedDashboardData(master);
		await seedDailyCalc();
		console.log('\nDone.\n');
	} catch (e: unknown) {
		console.error('\nSeed failed:', e);
		process.exit(1);
	}
}

main();
