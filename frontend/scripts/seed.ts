/**
 * Mock data seed script for the Smart Shelter dev environment.
 *
 * Usage:  pnpm seed  (from frontend/)
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
 * | seedRegistry — shelter master| plain object          | no factory (server-side only) |
 * | seedCatalog — supply items   | plain object          | no factory (no catalog feature) |
 * | seedCatalog — recipes        | plain object          | no factory (no catalog feature) |
 *
 * Safe to re-run: catalog and registry docs use deterministic IDs
 * (PUT → 409 = already exists → skip). Shelter docs use ULIDs so
 * re-running adds another batch — useful for volume testing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	applyMovementToStay,
	createEvacuee,
	createHousehold,
	createMedical,
	createMovement,
	createScreening,
	type Evacuee,
	type EvacueeInput,
	type HouseholdInput,
	type MedicalInput,
	type MovementInput,
	type ScreeningInput
} from '$lib/features/people/domain/people';
import {
	createCampaign,
	createStockLedger,
	createWalkInDonation,
	type CampaignInput,
	type StockLedgerInput,
	type WalkInDonationInput
} from '$lib/features/operations/domain/operations';
import { createInitialProfile } from '$lib/features/sop-ratios';
import { SOP_MASTER_SCHEMA_VERSION } from '$lib/features/sop-ratios/domain/sop-ratio';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';
import { type AuthorContext, now } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';

import { deployShelterViewsFn } from '$lib/features/shelters/server';

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

async function bulkDocs(db: string, docs: unknown[]): Promise<void> {
	const { status, data } = await couchReq('POST', `/${db}/_bulk_docs`, { docs });
	if (status !== 201) throw new Error(`_bulk_docs to "${db}" failed (HTTP ${status})`);
	const results = data as { id: string; ok?: boolean; error?: string; reason?: string }[];
	const errs = results.filter((r) => r.error && r.error !== 'conflict');
	if (errs.length) console.warn(`  ⚠ non-conflict errors in ${db}:`, errs.slice(0, 5));
}

// ─── catalog helpers ──────────────────────────────────────────────────────────

function catalogDoc(id: string, type: string, body: Record<string, unknown>) {
	const ts = now();
	return {
		_id: id,
		type,
		schema_v: 1,
		created_at: ts,
		updated_at: ts,
		created_by: 'seed',
		...body
	};
}

// ─── constants ────────────────────────────────────────────────────────────────

const SHELTER_CODE = 'SH001';
const SHELTER_DB = 'shelter_sh001';
const CTX: AuthorContext = { shelterCode: SHELTER_CODE, createdBy: 'seed' };

const SHELTER_CODE_2 = 'SH002';
const SHELTER_DB_2 = 'shelter_sh002';
const CTX_2: AuthorContext = { shelterCode: SHELTER_CODE_2, createdBy: 'seed' };

// Supply item IDs — referenced by operations seed data below.
const ITEM = {
	rice: 'item:rice',
	water: 'item:water',
	paracetamol: 'item:paracetamol',
	soap: 'item:soap',
	blanket: 'item:blanket',
	egg: 'item:egg'
} as const;

// ─── seedRegistry ─────────────────────────────────────────────────────────────

async function seedRegistry(): Promise<void> {
	await ensureDb('registry');
	await setSecurity('registry', {
		admins: { names: [], roles: ['system_admin'] },
		members: {
			names: [],
			roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff']
		}
	});

	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	let hasSH001 = false;
	let hasSH002 = false;
	if (status === 200) {
		const rows = (data as { rows?: { doc?: { type?: string; code?: string } }[] }).rows ?? [];
		hasSH001 = rows.some((r) => r.doc?.type === 'shelter' && r.doc?.code === SHELTER_CODE);
		hasSH002 = rows.some((r) => r.doc?.type === 'shelter' && r.doc?.code === SHELTER_CODE_2);
	}

	const ts = now();
	if (!hasSH001) {
		await putDoc('registry', {
			_id: `shelter:${ulid()}`,
			type: 'shelter',
			schema_v: 1,
			code: SHELTER_CODE,
			name: 'ศูนย์พักพิงสงขลา (ทดสอบ)',
			status: 'open',
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
			opened_at: ts,
			created_at: ts,
			updated_at: ts,
			created_by: 'seed'
		});
		console.log('  ✓ registry: 1 shelter master (SH001)');
	} else {
		console.log('  ✓ registry: shelter SH001 already exists, skipping');
	}

	if (!hasSH002) {
		await putDoc('registry', {
			_id: `shelter:${ulid()}`,
			type: 'shelter',
			schema_v: 1,
			code: SHELTER_CODE_2,
			name: 'ศูนย์พักพิงปัตตานี (ทดสอบ)',
			status: 'open',
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
			opened_at: ts,
			created_at: ts,
			updated_at: ts,
			created_by: 'seed'
		});
		console.log('  ✓ registry: 1 shelter master (SH002)');
	} else {
		console.log('  ✓ registry: shelter SH002 already exists, skipping');
	}
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
		})
	];
	const recipes = [
		catalogDoc('recipe:fried-egg-rice', 'recipe', {
			name: 'ข้าวไข่เจียว',
			serving_unit: 'box',
			ingredients: [
				{ item_id: ITEM.rice, qty: 0.2, unit: 'kg' },
				{ item_id: ITEM.egg, qty: 2, unit: 'piece' }
			],
			tags: [],
			active: true
		}),
		catalogDoc('recipe:congee', 'recipe', {
			name: 'ข้าวต้ม',
			serving_unit: 'bowl',
			ingredients: [{ item_id: ITEM.rice, qty: 0.15, unit: 'kg' }],
			tags: ['soft_food'],
			active: true
		})
	];

	for (const doc of [...items, ...recipes]) await putDoc('catalog', doc);
	console.log(`  ✓ catalog: ${items.length} supply items, ${recipes.length} recipes`);
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
		if (doc.schema_v === SOP_MASTER_SCHEMA_VERSION) {
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

	const { profile, audit } = createInitialProfile(
		'sop_profile',
		'Sphere Baseline',
		validRatios,
		{ createdBy: 'seed' }
	);

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

// ─── seedShelter ──────────────────────────────────────────────────────────────

async function seedShelter(): Promise<void> {
	await ensureDb(SHELTER_DB);
	await setSecurity(SHELTER_DB, {
		admins: { names: [], roles: ['system_admin'] },
		members: { names: [], roles: [`shelter:${SHELTER_CODE}`] }
	});
	await deployShelterViewsFn(SHELTER_DB, (path, method, body) => couchReq(method, path, body));

	// — households ——————————————————————————————————————————————————————————————
	const hhInputs: HouseholdInput[] = [
		{
			label: 'ครอบครัวใจดี',
			zone: 'Z1',
			head_evacuee_id: null,
			pets: [],
			notes: 'ครอบครัวใหญ่ 4 คน'
		},
		{
			label: 'ครอบครัวสุขสาย',
			zone: 'Z1',
			head_evacuee_id: null,
			pets: [{ species: 'dog', count: 1 }]
		},
		{ label: 'ครอบครัวรักสงบ', zone: 'Z2', head_evacuee_id: null, pets: [] }
	];
	const [hh1, hh2, hh3] = hhInputs.map((h) => createHousehold(h, CTX));

	// — evacuees ————————————————————————————————————————————————————————————————
	const evacueeInputs: EvacueeInput[] = [
		// hh1 — family of 4 (สมชาย household)
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0811111111',
			birth_year: 1955,
			religion: 'buddhist',
			special_needs: ['elderly'],
			household_id: hh1._id,
			registered_via: 'import'
		},
		{
			first_name: 'สมหญิง',
			last_name: 'ใจดี',
			gender: 'female',
			phone: '0812222222',
			birth_year: 1958,
			religion: 'buddhist',
			special_needs: ['elderly'],
			household_id: hh1._id,
			registered_via: 'import'
		},
		{
			first_name: 'ประเสริฐ',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0813333333',
			birth_year: 1990,
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
			birth_year: 1993,
			religion: 'buddhist',
			special_needs: ['pregnant'],
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
			birth_year: 1988,
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
			birth_year: 1985,
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
			birth_year: 2024,
			religion: 'buddhist',
			special_needs: ['infant'],
			household_id: hh2._id,
			registered_via: 'import'
		},
		// hh3 — Muslim family (วิชัย household)
		{
			first_name: 'วิชัย',
			last_name: 'รักสงบ',
			gender: 'male',
			phone: '0816666666',
			birth_year: 1972,
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
			birth_year: 1975,
			religion: 'muslim',
			special_needs: ['chronic_illness'],
			household_id: hh3._id,
			registered_via: 'import',
			emergency_contact: { name: 'วิชัย รักสงบ', phone: '0816666666', relation: 'สามี' }
		},
		{
			first_name: 'อาเซ็ม',
			last_name: 'รักสงบ',
			gender: 'male',
			phone: null,
			birth_year: 2012,
			religion: 'muslim',
			special_needs: [],
			household_id: hh3._id,
			registered_via: 'import'
		}
	];
	const evacuees = evacueeInputs.map((e) => createEvacuee(e, CTX));

	// — movements (check_in for every evacuee) —————————————————————————————————
	const movementInputs: MovementInput[] = evacuees.map((e) => ({
		evacuee_id: e._id,
		action: 'check_in' as const,
		zone: evacueeInputs[evacuees.indexOf(e)].household_id === hh3._id ? 'Z2' : 'Z1'
	}));
	const movements = movementInputs.map((m) => createMovement(m, CTX));

	// Apply check-in to each evacuee's current_stay snapshot.
	const checkedInEvacuees = evacuees.map((e, i) => applyMovementToStay(e, movements[i]));

	// — medical records ————————————————————————————————————————————————————————
	const medicalInputs: MedicalInput[] = [
		{
			evacuee_id: evacuees[0]._id,
			blood_group: 'O',
			conditions: ['ความดันโลหิตสูง'],
			medications: ['แอมโลดิปีน 5mg'],
			allergies: [],
			track: 'fast_track'
		},
		{
			evacuee_id: evacuees[1]._id,
			blood_group: 'A',
			conditions: ['เบาหวานชนิดที่ 2'],
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
			conditions: ['โรคหอบหืด'],
			medications: ['ซัลบูทามอล'],
			allergies: ['ซัลฟา'],
			track: 'fast_track'
		}
	];
	const medicals = medicalInputs.map((m) => createMedical(m, CTX));

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
	const screenings = screeningInputs.map((s) => createScreening(s, CTX));

	// — stock ledger ——————————————————————————————————————————————————————————
	const stockInputs: StockLedgerInput[] = [
		{ item_id: ITEM.rice, qty: 200, unit: 'kg', reason: 'receive', ref_id: null },
		{ item_id: ITEM.water, qty: 500, unit: 'bottle', reason: 'receive', ref_id: null },
		{ item_id: ITEM.paracetamol, qty: 1000, unit: 'tablet', reason: 'receive', ref_id: null },
		{ item_id: ITEM.soap, qty: 150, unit: 'bar', reason: 'receive', ref_id: null },
		{ item_id: ITEM.blanket, qty: 80, unit: 'piece', reason: 'receive', ref_id: null },
		{ item_id: ITEM.rice, qty: -30, unit: 'kg', reason: 'distribute', ref_id: null },
		{ item_id: ITEM.water, qty: -100, unit: 'bottle', reason: 'distribute', ref_id: null }
	];
	const stockEntries = stockInputs.map((s) => createStockLedger(s, CTX));

	// — donation campaigns ————————————————————————————————————————————————————
	const campaignInputs: CampaignInput[] = [
		{
			title: 'รับบริจาคอาหารและน้ำดื่ม',
			needs: [
				{ item_id: ITEM.rice, qty_target: 500, unit: 'kg' },
				{ item_id: ITEM.water, qty_target: 1000, unit: 'bottle' }
			],
			notes: 'เปิดรับบริจาคเพื่อผู้ประสบภัยน้ำท่วม'
		},
		{
			title: 'รับบริจาคของใช้ส่วนตัว',
			needs: [
				{ item_id: ITEM.soap, qty_target: 200, unit: 'bar' },
				{ item_id: ITEM.blanket, qty_target: 100, unit: 'piece' }
			]
		}
	];
	const campaigns = campaignInputs.map((c) => createCampaign(c, CTX));

	// — donations ——————————————————————————————————————————————————————————————
	const donationInputs: WalkInDonationInput[] = [
		{
			donor: { name: 'บริษัท ซีพีเอฟ จำกัด', phone: '022222222', phone_hash: 'mock-hash-cpf' },
			kind: 'items',
			items: [{ item_id: ITEM.rice, qty: 50, unit: 'kg' }],
			campaign_id: campaigns[0]._id,
			tracking_token_hash: 'mock-track-001'
		},
		{
			donor: { name: 'วัดท่าสะอ้าน', phone: null, phone_hash: 'mock-hash-wat' },
			kind: 'items',
			items: [
				{ item_id: ITEM.water, qty: 100, unit: 'bottle' },
				{ item_id: ITEM.blanket, qty: 20, unit: 'piece' }
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
	const donations = donationInputs.map((d) => createWalkInDonation(d, CTX));

	// — bulk insert ——————————————————————————————————————————————————————————
	const allDocs = [
		...hhInputs.map((_, i) => [hh1, hh2, hh3][i]),
		...checkedInEvacuees,
		...movements,
		...medicals,
		...screenings,
		...stockEntries,
		...campaigns,
		...donations
	];
	await bulkDocs(SHELTER_DB, allDocs);

	console.log(
		`  ✓ ${SHELTER_DB}: 3 households, ${evacuees.length} evacuees, ${movements.length} movements`
	);
	console.log(`  ✓ ${SHELTER_DB}: ${medicals.length} medicals, ${screenings.length} screenings`);
	console.log(
		`  ✓ ${SHELTER_DB}: ${stockEntries.length} stock entries, ${campaigns.length} campaigns, ${donations.length} donations`
	);
}

async function seedShelter2(): Promise<void> {
	await ensureDb(SHELTER_DB_2);
	await setSecurity(SHELTER_DB_2, {
		admins: { names: [], roles: ['system_admin'] },
		members: { names: [], roles: [`shelter:${SHELTER_CODE_2}`] }
	});
	await deployShelterViewsFn(SHELTER_DB_2, (path, method, body) => couchReq(method, path, body));

	const { status, data } = await couchReq('GET', `/${SHELTER_DB_2}/_all_docs?limit=1`);
	if (status === 200 && (data as { rows?: unknown[] }).rows?.length) {
		console.log(`  ✓ ${SHELTER_DB_2}: already seeded, skipping`);
		return;
	}

	// — households ——————————————————————————————————————————————————————————————
	const hhInputs: HouseholdInput[] = [
		{
			label: 'ครอบครัวปัตตานี',
			zone: 'Z1',
			head_evacuee_id: null,
			pets: [],
			notes: 'ตัวอย่าง SH002'
		}
	];
	const [hh1] = hhInputs.map((h) => createHousehold(h, CTX_2));

	// — evacuees ————————————————————————————————————————————————————————————————
	const evacueeInputs: EvacueeInput[] = [
		{
			first_name: 'ดานียา',
			last_name: 'มานะ',
			gender: 'female',
			phone: '0899998888',
			birth_year: 1995,
			religion: 'muslim',
			special_needs: [],
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
		{ item_id: ITEM.water, qty: 100, unit: 'bottle', reason: 'receive', ref_id: null }
	];
	const stockEntries = stockInputs.map((s) => createStockLedger(s, CTX_2));

	const allDocs = [hh1, ...checkedInEvacuees, ...movements, ...stockEntries];
	await bulkDocs(SHELTER_DB_2, allDocs);

	console.log(`  ✓ ${SHELTER_DB_2}: 1 household, 1 evacuee, 1 movement, 1 stock entry`);
}

// ─── seedDashboardData ────────────────────────────────────────────────────────
async function seedDashboardData(): Promise<void> {
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

	const COUNTRIES = ['THAILAND', 'THAILAND', 'THAILAND', 'MYANMAR', 'LAOS', 'CAMBODIA', 'UNKNOWN'];
	const STATUSES = [
		'registered',
		'checked_in',
		'checked_in',
		'checked_out',
		'transferred'
	] as const;
	const CURRENT_YEAR = new Date().getFullYear();

	function rnd(min: number, max: number) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	function randomDatePast30Days() {
		const date = new Date();
		date.setDate(date.getDate() - rnd(0, 30));
		return date.toISOString();
	}

	const NUM_DOCS = 100;
	const docs: Evacuee[] = [];
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
			registered_via: 'import'
		};

		const doc = createEvacuee(input, CTX);

		// Force override for views & identification
		doc._id = `evacuee:seed-genname-${i}`;
		(doc as Evacuee & { country: string }).country = country;
		doc.current_stay.status = status;
		doc.created_at = randomDatePast30Days();

		docs.push(doc);
	}

	await bulkDocs(SHELTER_DB, docs);
	console.log(`\n  --- 📊 Dashboard Seed Stats (${NUM_DOCS} docs) ---`);
	console.log(`  [Status] :`, stats.status);
	console.log(`  [Country]:`, stats.country);
	console.log(`  [Age]    :`, stats.age);
	console.log(`  --------------------------------------------\n`);
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
		await seedRegistry();
		await seedCatalog();
		await seedCatalogSopRatios();
		await seedShelter();
		await seedShelter2();
		await seedDashboardData();
		console.log('\nDone.\n');
	} catch (err) {
		console.error('\nSeed failed:', err);
		process.exit(1);
	}
}

main();
