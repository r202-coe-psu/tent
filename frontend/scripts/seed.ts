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
import { type AuthorContext, now } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';

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
		members: { names: [], roles: [] }
	});

	// Idempotent by code-check (matching the admin endpoint pattern) — not by fixed _id.
	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (status === 200) {
		const rows = (data as { rows?: { doc?: { type?: string; code?: string } }[] }).rows ?? [];
		if (rows.some((r) => r.doc?.type === 'shelter' && r.doc?.code === SHELTER_CODE)) {
			console.log('  ✓ registry: shelter SH001 already exists, skipping');
			return;
		}
	}

	const ts = now();
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
}

// ─── seedCatalog ──────────────────────────────────────────────────────────────

async function seedCatalog(): Promise<void> {
	await ensureDb('catalog');
	await setSecurity('catalog', {
		admins: { names: [], roles: ['system_admin'] },
		members: { names: [], roles: [] }
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
	const deterministicId = 'master_sphere_baseline';
	const fullDocId = `sop_profile:${deterministicId}`;
	const { status } = await couchReq('GET', `/catalog/${encodeURIComponent(fullDocId)}`);

	if (status === 200) {
		console.log('  ✓ catalog: SOP Ratio "Sphere Baseline" already exists, skipping');
		return;
	}

	if (status !== 404) {
		throw new Error(`seedCatalogSopRatios: unexpected status ${status} checking ${fullDocId}`);
	}

	const { profile, audit } = createInitialProfile(
		'sop_profile',
		'Sphere Baseline',
		{
			water_l_per_person_day: 15, // liters/person/day
			rice_g_per_person_meal: 200, // grams/person/meal
			toilet_per_person: 0.05 // toilets/person
		},
		{ createdBy: 'seed' }
	);

	// Override standard ULIDs with deterministic IDs for idempotency scan boundary
	profile._id = fullDocId;
	audit.target_id = fullDocId;
	audit._id = `audit:seed_sphere_baseline`;

	await bulkDocs('catalog', [profile, audit]);
	console.log('  ✓ catalog: SOP Ratio "Sphere Baseline" seeded');
}

// ─── seedShelter ──────────────────────────────────────────────────────────────

async function seedShelter(): Promise<void> {
	await ensureDb(SHELTER_DB);
	await setSecurity(SHELTER_DB, {
		admins: { names: [], roles: ['system_admin'] },
		members: { names: [], roles: [`shelter:${SHELTER_CODE}`] }
	});

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

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
	const displayUrl = rawCouchUrl.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
	console.log(`\nSeeding mock data → ${displayUrl}\n`);
	try {
		await seedRegistry();
		await seedCatalog();
		await seedCatalogSopRatios();
		await seedShelter();
		console.log('\nDone.\n');
	} catch (err) {
		console.error('\nSeed failed:', err);
		process.exit(1);
	}
}

main();
