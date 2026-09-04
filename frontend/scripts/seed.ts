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
 * | seedVolunteers — jobs/volunteers/shifts/applications | makeJob, makeVolunteer, makeJobApplication, makeShiftAssignment | volunteers domain (00-foundation.md §00.5) |
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

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSecurityAnswer } from '$lib/server/security-questions';

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
import { DEFAULT_FOOD_SPHERE_STANDARDS } from '$lib/features/sop-ratios/domain/food-sphere.fixture';
import { DEFAULT_REPLENISHMENT_POLICIES } from '$lib/features/sop-ratios/domain/replenishment-policy.fixture';
import { DEFAULT_REQUIREMENT_GROUPS } from '$lib/features/sop-ratios/domain/requirement-group.fixture';
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
import { makeJob, jobSchema, type JobInput } from '$lib/features/volunteers/domain/job.schema';
import {
	makeVolunteer,
	volunteerSchema,
	type VolunteerInput
} from '$lib/features/volunteers/domain/volunteer.schema';
import {
	makeJobApplication,
	jobApplicationSchema,
	type JobApplicationInput
} from '$lib/features/volunteers/domain/job-application.schema';
import {
	makeShiftAssignment,
	shiftAssignmentSchema,
	type ShiftAssignmentInput,
	type ShiftKind
} from '$lib/features/volunteers/domain/shift-assignment.schema';
import { bangkokDateString, resolveDutyWindow } from '$lib/features/volunteers/domain/duty-window';
import { nextVolunteerCode } from '$lib/features/volunteers/domain/volunteer-code';
import { initialStatusForSkills } from '$lib/features/volunteers/domain/skills';
import { shelterCodeSchema, type AuthorContext, makeDoc, now } from '$lib/db/model';
import { sha256Hex } from '$lib/db/hash';
import { ulid } from '$lib/db/ulid';
import { deployShelterViewsFn } from '$lib/features/shelters/server/deploy';
import { parseCouchCredentialUrl } from '$lib/server/couch-credentials';
import { ensurePublicWriter } from '$lib/server/ensure-public-writer';
import {
	buildValidateDocUpdate,
	REFERRAL_MANGO_INDEXES,
	shelterDbName
} from '$lib/server/shelter-access-design';
import { buildRegistryDesignDoc, REGISTRY_DESIGN_ID } from '$lib/server/registry-design';
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

/**
 * Username of the limited-permission public writer (`putAsPublicWriter`), added
 * to each shelter's `_security.members.names`. Empty when unset — dev then falls
 * back to admin credentials inside `putAsPublicWriter`.
 */
const PUBLIC_WRITER_NAMES: string[] = (() => {
	const creds = parseCouchCredentialUrl(
		process.env.COUCHDB_PUBLIC_WRITER_URL ?? env.COUCHDB_PUBLIC_WRITER_URL
	);
	return creds ? [creds.user] : [];
})();

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
async function putDoc(db: string, doc: Record<string, unknown> | { _id: string }): Promise<void> {
	const id = (doc as { _id: string })._id;
	const { status } = await couchReq('PUT', `/${db}/${encodeURIComponent(id)}`, doc);
	if (status !== 201 && status !== 409)
		throw new Error(`PUT ${id} → ${db} failed (HTTP ${status})`);
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

// Registry-only, like SH003 — no per-shelter database. Exists so the host-house
// site kind (CR-067) has a fixture in list/filter/public-projection screens.
const SHELTER_CODE_4 = 'SH004';

/**
 * Registry master records — upserted on every seed run (name + location always applied).
 *
 * `shelter_type_key` and `admission_policy.supported_vulnerable_group_keys` are
 * seed-only handles into {@link MASTER_DATA_DEFS}; {@link seedRegistry} swaps them
 * for the persisted master_data item codes, which is what those two fields store.
 * A shelter must list every vulnerable-group code its evacuees use — the
 * registration/health forms only offer chips whose code is in this list.
 *
 * `site_kind` is optional here: omitting it seeds the pre-CR-067 shape that the
 * read-time migration back-fills to `evacuation_center`, so both the migrated and
 * the explicitly-tagged paths stay covered.
 */
const REGISTRY_SHELTERS = [
	{
		code: SHELTER_CODE,
		name: 'ศูนย์อพยพศูนย์กีฬามหาวิทยาลัยสงขลานครินทร์',
		location: {
			lat: 7.010027132382802,
			lng: 100.50024358303605,
			address: '15 ถ.กาญจนวนิช ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา 90110'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		shelter_type_key: 'sports_centre',
		area_type: 'indoor',
		capacity: 200,
		zones: [
			{ code: 'Z1', name: 'อาคารยิมเนเซียม 1', capacity: 100, area_m2: 500, type: 'general' },
			{ code: 'Z2', name: 'อาคารยิมเนเซียม 2', capacity: 60, area_m2: 350, type: 'family' },
			{ code: 'Z3', name: 'โซนดูแลกลุ่มเปราะบาง', capacity: 25, area_m2: 200, type: 'vulnerable' },
			{ code: 'Z4', name: 'โซนสัตว์เลี้ยง', capacity: 15, area_m2: 150, type: 'pet' }
		],
		area_m2: 1200,
		facilities: {
			toilets_female: 10,
			toilets_male: 8,
			toilets_accessible: 4,
			showers: 12,
			car_toilet_supported: 2,
			water_points: 8,
			handwashing_stations: 12
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular', 'vhf_radio']
		},
		common_areas: {
			central_kitchen: true,
			parking_capacity: 50
		},
		key_personnel: {
			eoc_liaison: {
				name: 'ดร.สมศักดิ์ วิจิตรการ (ผู้จัดการศูนย์)',
				phone: '074-282000 ต่อ 101'
			}
		},
		contact: {
			name: 'ดร.สมศักดิ์ วิจิตรการ (ผู้จัดการศูนย์)',
			phone: '074-282000 ต่อ 101'
		},
		risk: {
			entrance_description:
				'ถ.กาญจนวนิช ประตู 10 ม.อ. (สัญจรสะดวก รถทุกชนิดเข้าได้ ไม่มีน้ำท่วมขัง)',
			elevation_m: 18,
			constraints: 'พื้นที่ยกสูง ปลอดภัยจากน้ำหลากในระดับวิกฤต'
		},
		admission_policy: {
			pet_policy: {
				policy: 'conditional',
				categories: [{ category: 'small_general' }, { category: 'large_dog' }]
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
		location: {
			lat: 7.015427802879699,
			lng: 100.47291623646029,
			address: '445 ถ.เพชรเกษม ต.หาดใหญ่ อ.หาดใหญ่ จ.สงขลา 90110'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'หาดใหญ่',
		shelter_type_key: 'government_building',
		area_type: 'indoor',
		capacity: 100,
		zones: [
			{ code: 'Z1', name: 'ห้องประชุมใหญ่ชั้น 1', capacity: 70, area_m2: 250, type: 'general' },
			{ code: 'Z2', name: 'ห้องดูแลพิเศษ', capacity: 30, area_m2: 150, type: 'vulnerable' }
		],
		area_m2: 400,
		facilities: {
			toilets_female: 6,
			toilets_male: 4,
			toilets_accessible: 2,
			showers: 6,
			car_toilet_supported: 1,
			water_points: 4,
			handwashing_stations: 6
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular']
		},
		common_areas: {
			central_kitchen: true,
			parking_capacity: 30
		},
		contact: {
			name: 'นายอดิศร สุขสมบูรณ์ (หัวหน้าฝ่ายป้องกันและบรรเทาสาธารณภัย)',
			phone: '074-200000'
		},
		risk: {
			entrance_description: 'ถ.เพชรเกษม ด้านหน้าเทศบาลนครหาดใหญ่',
			elevation_m: 12,
			constraints: null
		},
		admission_policy: {
			pet_policy: { policy: 'not_allowed' },
			supported_vulnerable_group_keys: ['elderly', 'pregnant', 'chronic_illness']
		}
	},
	{
		code: SHELTER_CODE_3,
		name: 'ศูนย์อพยพสำนักงานเทศบาลเมืองบ้านพรุ',
		location: {
			lat: 6.948086391528152,
			lng: 100.47963181135452,
			address: '1 ถ.กาญจนวนิช ต.บ้านพรุ อ.หาดใหญ่ จ.สงขลา 90250'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'บ้านพรุ',
		shelter_type_key: 'community_hall',
		area_type: 'hybrid',
		capacity: 100,
		zones: [
			{ code: 'Z1', name: 'โซนรวม', capacity: 50, area_m2: 200, type: 'general' },
			{ code: 'Z2', name: 'โซนสัตว์เลี้ยง', capacity: 50, area_m2: 200, type: 'pet' }
		],
		area_m2: 400,
		facilities: {
			toilets_female: 4,
			toilets_male: 4,
			toilets_accessible: 1,
			showers: 4,
			car_toilet_supported: 0,
			water_points: 3,
			handwashing_stations: 4
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular']
		},
		common_areas: {
			central_kitchen: false,
			parking_capacity: 20
		},
		contact: {
			name: 'นายธีระพล พรหมประสิทธิ์',
			phone: '074-291111'
		},
		risk: {
			entrance_description: 'ถ.กาญจนวนิช สายเก่า',
			elevation_m: 15,
			constraints: null
		}
	},
	{
		code: SHELTER_CODE_4,
		name: 'บ้านพี่เลี้ยงชุมชนคอหงส์',
		site_kind: 'host_house',
		location: {
			lat: 7.006114303226103,
			lng: 100.4967812435841,
			address: '88 ซอย 5 บ้านทุ่ง ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา 90110'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		shelter_type_key: 'community_hall',
		area_type: 'indoor',
		capacity: 8,
		zones: [{ code: 'Z1', name: 'ห้องพักรวม', capacity: 8, area_m2: 60, type: 'general' }],
		area_m2: 60,
		facilities: {
			toilets_female: 1,
			toilets_male: 1,
			toilets_accessible: 0,
			showers: 1,
			car_toilet_supported: 0,
			water_points: 1,
			handwashing_stations: 1
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular']
		},
		common_areas: {
			central_kitchen: false,
			parking_capacity: 2
		},
		contact: {
			name: 'นางวรรณา ใจดี (เจ้าของบ้านพี่เลี้ยง)',
			phone: '086-123-4567'
		},
		risk: {
			entrance_description: 'ซอย 5 เข้าจาก ถ.กาญจนวนิช 100 เมตร',
			elevation_m: 16,
			constraints: null
		},
		admission_policy: {
			pet_policy: { policy: 'not_allowed' },
			supported_vulnerable_group_keys: ['elderly', 'young_child']
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

interface SeedUserConfig {
	name: string;
	display_name: string;
	roles: string[];
	personnel_type: 'staff' | 'volunteer';
	organization: string | null;
	position: string | null;
	phone: string;
	email: string | null;
	shelter_id: string | null;
	question_id:
		| 'high_school'
		| 'birth_province'
		| 'first_pet'
		| 'primary_school'
		| 'favorite_teacher'
		| 'first_workplace';
	raw_answer: string;
}

const SEED_USERS: SeedUserConfig[] = [
	{
		name: 'sa01',
		display_name: 'ผู้ดูแลระบบสูงสุด (System Admin)',
		roles: ['system_admin'],
		personnel_type: 'staff',
		organization: 'ศูนย์ปฏิบัติการส่วนกลาง (EOC)',
		position: 'System Administrator',
		phone: '0800000001',
		email: 'sa01@smart-shelter.org',
		shelter_id: null,
		question_id: 'birth_province',
		raw_answer: 'กรุงเทพมหานคร'
	},
	{
		name: 'staff01',
		display_name: 'สมชาย ประจำการ (Staff 01)',
		roles: ['shelter:SH001', 'registration_staff', 'triage_staff'],
		personnel_type: 'staff',
		organization: 'กรมป้องกันและบรรเทาสาธารณภัย',
		position: 'เจ้าหน้าที่รับลงทะเบียนและคัดกรอง',
		phone: '0812345601',
		email: 'staff01@smart-shelter.org',
		shelter_id: SH001_CODE,
		question_id: 'high_school',
		raw_answer: 'กรุงเทพคริสเตียน'
	},
	{
		name: 'staff02',
		display_name: 'พว. สมหญิง การุณ (Staff 02)',
		roles: ['shelter:SH001', 'medical_staff'],
		personnel_type: 'staff',
		organization: 'โรงพยาบาลศูนย์หาดใหญ่',
		position: 'พยาบาลวิชาชีพ',
		phone: '0812345602',
		email: 'staff02@smart-shelter.org',
		shelter_id: SH001_CODE,
		question_id: 'first_pet',
		raw_answer: 'เจ้าด่าง'
	},
	{
		name: 'staff03',
		display_name: 'วิชัย มั่นคง (Staff 03)',
		roles: ['shelter:SH001', 'volunteer_coordinator', 'supply_coordinator', 'kitchen_staff'],
		personnel_type: 'staff',
		organization: 'มูลนิธิกระจกเงา',
		position: 'ผู้ประสานงานจิตอาสาและคลัง',
		phone: '0812345603',
		email: 'staff03@smart-shelter.org',
		shelter_id: SH001_CODE,
		question_id: 'favorite_teacher',
		raw_answer: 'ครูสมศรี'
	},
	{
		name: '0891234567',
		display_name: 'กิตติ จิตอาสา (Volunteer Staff)',
		roles: ['shelter:SH001', 'registration_staff'],
		personnel_type: 'volunteer',
		organization: 'กลุ่มอาสาใจถึงใจ',
		position: 'อาสาช่วยงานลงทะเบียน',
		phone: '0891234567',
		email: 'volunteer01@example.com',
		shelter_id: SH001_CODE,
		question_id: 'primary_school',
		raw_answer: 'อนุบาลวัดป่า'
	}
];

/** Create sa01 + staff01–staff03 + volunteer test logins in CouchDB `_users` (idempotent / upsert). */
async function seedUsers(): Promise<void> {
	let created = 0;
	let updated = 0;

	for (const u of SEED_USERS) {
		const docId = `${USER_PREFIX}${encodeURIComponent(u.name)}`;
		const existing = await couchReq('GET', `/_users/${docId}`);
		const existingDoc = existing.status === 200 ? (existing.data as Record<string, unknown>) : null;

		const { answer_hash, salt } = hashSecurityAnswer(u.raw_answer);
		const security_question = {
			question_id: u.question_id,
			answer_hash,
			salt,
			set_at: new Date().toISOString()
		};

		const userDoc: Record<string, unknown> = {
			...(existingDoc ?? {}),
			name: u.name,
			display_name: u.display_name,
			roles: u.roles,
			type: 'user',
			personnel_type: u.personnel_type,
			organization: u.organization,
			position: u.position,
			phone: u.phone,
			email: u.email,
			shelter_id: u.shelter_id,
			active: true,
			must_change_password: false,
			security_question,
			affiliation_tags: (existingDoc?.affiliation_tags as string[]) ?? []
		};

		if (!existingDoc) {
			userDoc.password = SEED_STAFF_PASSWORD;
		}

		const { status } = await couchReq('PUT', `/_users/${docId}`, userDoc);
		if (status === 201) {
			if (existingDoc) updated += 1;
			else created += 1;
		} else if (status === 409) {
			// retry with latest rev if conflict
			const latest = await couchReq('GET', `/_users/${docId}`);
			if (latest.status === 200) {
				const latestDoc = latest.data as Record<string, unknown>;
				userDoc._rev = latestDoc._rev;
				await couchReq('PUT', `/_users/${docId}`, userDoc);
				updated += 1;
			}
		} else {
			throw new Error(`PUT _users/${u.name} failed (HTTP ${status})`);
		}
	}

	console.log(
		`  ✓ _users: sa01, staff01–03, 0891234567 (${created} created, ${updated} updated with metadata)`
	);

	await seedPublicWriter();
}

async function seedPublicWriter(): Promise<void> {
	const result = await ensurePublicWriter(
		couchReq,
		process.env.COUCHDB_PUBLIC_WRITER_URL ?? env.COUCHDB_PUBLIC_WRITER_URL
	);
	if (result.outcome === 'skipped') {
		console.log('  – _users: COUCHDB_PUBLIC_WRITER_URL unset — public writer not seeded');
		return;
	}
	console.log(
		`  ✓ _users: public writer "${result.username}" (${result.outcome === 'created' ? 'created' : 'already exists'})`
	);
}

// ─── seedRegistry ─────────────────────────────────────────────────────────────

/**
 * Idempotent PUT of the registry `_design/app` (`by_code` view) so
 * `findMasterByCode` and the public booking BFF can look a shelter up by code
 * instead of scanning the whole registry.
 */
async function deployRegistryDesign(): Promise<void> {
	const desired = buildRegistryDesignDoc();
	const existing = await couchReq('GET', `/registry/${REGISTRY_DESIGN_ID}`);
	const current =
		existing.status === 200
			? (existing.data as { _rev?: string; views?: Record<string, { map: string }> })
			: null;

	if (current && current.views?.by_code?.map === desired.views.by_code.map) {
		console.log('  ✓ registry: _design/app already current');
		return;
	}

	const { status } = await couchReq('PUT', `/registry/${REGISTRY_DESIGN_ID}`, {
		...desired,
		...(current?._rev ? { _rev: current._rev } : {})
	});
	if (status !== 201 && status !== 202) {
		throw new Error(`Cannot deploy registry _design/app (HTTP ${status})`);
	}
	console.log('  ✓ registry: _design/app (by_code view) deployed');
}

async function seedRegistry(master: MasterLookup): Promise<void> {
	await ensureDb('registry');
	await setSecurity('registry', {
		admins: { names: [], roles: ['system_admin'] },
		members: {
			names: [],
			roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff']
		}
	});
	await deployRegistryDesign();

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
		if ('site_kind' in shelter) extras.site_kind = shelter.site_kind;
		if ('province' in shelter) extras.province = shelter.province;
		if ('district' in shelter) extras.district = shelter.district;
		if ('subdistrict' in shelter) extras.subdistrict = shelter.subdistrict;
		if ('area_type' in shelter) extras.area_type = shelter.area_type;
		if ('facilities' in shelter) extras.facilities = { ...shelter.facilities };
		if ('utilities' in shelter) extras.utilities = { ...shelter.utilities };
		if ('common_areas' in shelter) extras.common_areas = { ...shelter.common_areas };
		if ('key_personnel' in shelter) extras.key_personnel = { ...shelter.key_personnel };
		if ('contact' in shelter) extras.contact = { ...shelter.contact };
		if ('risk' in shelter) extras.risk = { ...shelter.risk };
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
				capacity: shelter.capacity,
				area_m2: shelter.area_m2,
				zones: shelter.zones.map((z) => ({ ...z })),
				updated_at: ts,
				...extras
			});
			console.log(
				`  ✓ registry: updated shelter ${shelter.code} (name + location + policies + details)`
			);
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
				opened_at: ts,
				created_at: ts,
				updated_at: ts,
				created_by: 'seed',
				...extras
			});
			console.log(`  ✓ registry: 1 shelter master (${shelter.code})`);
		}
	}

	// Seed test scanner device (kiosk-test / kisok-test-secret) in registry
	const testScannerSecret = 'kisok-test-secret';
	const testScannerDoc = {
		_id: 'scanner_device:kiosk-test',
		type: 'scanner_device',
		schema_v: 1,
		device_id: 'kiosk-test',
		name: 'Kiosk Test Scanner',
		shelter_code: SH001_CODE,
		station_name: 'จุดสแกน Kiosk ทดสอบ (Kiosk Test)',
		secret: testScannerSecret,
		secret_hash: createHash('sha256').update(testScannerSecret).digest('hex'),
		secret_prefix: testScannerSecret.slice(0, 16) + '...',
		status: 'active',
		last_seen_at: null,
		created_at: ts,
		updated_at: ts,
		created_by: 'seed'
	};
	await putDoc('registry', testScannerDoc);
	console.log(`  ✓ registry: 1 scanner device (kiosk-test)`);
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
	category?: 'operational' | 'controlled' | 'GENERAL' | 'CONTROLLED';
	description?: string;
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
	},
	{
		type: 'volunteer_skills',
		items: [
			{
				key: 'cooking',
				label: 'ประกอบอาหาร / ครัวสนาม',
				category: 'operational',
				description: 'ช่วยเตรียมวัตถุดิบ ปรุงอาหาร แจกอาหารครัวกลาง',
				is_default: true
			},
			{
				key: 'logistics',
				label: 'ขนย้ายสิ่งของ / พลาธิการ',
				category: 'operational',
				description: 'ขนย้ายกระสอบทราย ลำเลียงถุงยังชีพ ยกของหนัก'
			},
			{
				key: 'screening',
				label: 'คัดกรองและสแกนประวัติ',
				category: 'operational',
				description: 'ต้อนรับ ลงทะเบียน คัดกรองประวัติผู้ประสบภัยเบื้องต้น'
			},
			{
				key: 'medical',
				label: 'การแพทย์ / ปฐมพยาบาล',
				category: 'controlled',
				description: 'ปฐมพยาบาลเบื้องต้น วัดสัญญาณชีพ (ต้องผ่านการตรวจรับรองใบประกอบวิชาชีพ)'
			},
			{
				key: 'reception',
				label: 'ประสานงาน / ต้อนรับ',
				category: 'operational',
				description: 'ต้อนรับผู้ประสบภัย ประสานงานระหว่างจุดบริการ'
			},
			{
				key: 'distribution',
				label: 'แจกจ่ายของยังชีพ',
				category: 'operational',
				description: 'แจกจ่ายถุงยังชีพ น้ำดื่ม เครื่องอุปโภคบริโภค'
			},
			{
				key: 'sanitation',
				label: 'ทำความสะอาด / สุขอนามัย',
				category: 'operational',
				description: 'ทำความสะอาดพื้นที่ส่วนกลาง ดูแลสุขอนามัยในศูนย์'
			},
			{
				key: 'childcare',
				label: 'สันทนาการ / ดูแลเด็ก',
				category: 'operational',
				description: 'กิจกรรมสันทนาการ ดูแลเด็กและผู้สูงอายุ'
			},
			{
				key: 'transport',
				label: 'ขับขี่ยานพาหนะ / ขนส่ง',
				category: 'operational',
				description: 'ขับขี่ยานพาหนะขนส่งคนและสิ่งของ'
			}
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
	// item_master docs (catalog schema_v 3) — BOM recipes reference these, and the
	// kitchen resolves each to real stock (supply_item) by matching name AND unit
	// (resolveItemMasterStock). rice/egg/vegetable names+units match the
	// supply_items above, so BOM plans from them เบิก against real stock; the
	// canned-fish master has no supply_item counterpart, so a recipe using it
	// stays "unresolved" (demonstrates the block-on-unlinked-ingredient path).
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
				]
			},
			4
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

	// Never overwrite manually managed master profiles. The seed only supplies a
	// local-development baseline when the catalog has no master at all.
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

	// Idempotent fallback for older development catalog snapshots.
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

async function seedCatalogFoodSphereParameters(): Promise<void> {
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
		// Public writer joins by name (roleless) so its writes still go through
		// `_design/access` validate_doc_update — see seedPublicWriter().
		members: { names: [...PUBLIC_WRITER_NAMES], roles: [`shelter:${code}`] }
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
			notes: 'ครอบครัวใหญ่ 4 คน',
			address_no: '123/4',
			village_no: '3',
			subdistrict: 'หาดใหญ่',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110'
		},
		{
			label: 'ครอบครัวสุขสาย',
			municipality_zone: zone('zone_1'),
			community: community('rim_klong'),
			head_evacuee_id: null,
			// PetGroup.species is a fixed domain enum, not a master_data code — the
			// pet_types master feeds the config screens only.
			pets: [{ species: 'dog', count: 1 }],
			address_no: '45/1',
			village_no: '1',
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110'
		},
		{
			label: 'ครอบครัวรักสงบ',
			municipality_zone: zone('zone_2'),
			community: community('na_mueang'),
			head_evacuee_id: null,
			pets: [],
			address_no: '78/9',
			village_no: '5',
			subdistrict: 'คลองแห',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110'
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
			notes: 'ตัวอย่าง SH002',
			address_no: '99/2',
			village_no: '2',
			subdistrict: 'สะบารัง',
			district: 'เมืองปัตตานี',
			province: 'ปัตตานี',
			postal_code: '94000'
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

// ─── seedVolunteers ───────────────────────────────────────────────────────────

/**
 * `docs/plans/volunteer-backoffice/00-foundation.md` §00.5 — seed the
 * `volunteers` feature slice (jobs, volunteers, shift_assignments,
 * job_applications) into `SHELTER_DB` (SH001), built exclusively through the
 * feature's own domain factories (`makeJob`, `makeVolunteer`,
 * `makeJobApplication`, `makeShiftAssignment`) — never a hand-rolled envelope.
 * (`volunteer_transfer` was cut entirely by CR-104 AC-104-10.)
 *
 * `resolveDutyWindow(date, shift)` (Bangkok wall-clock → UTC, `duty-window.ts`)
 * is the ONLY source of `duty_window` values here — no hand-written ISO
 * literals — and `date` is always "today" computed the same way
 * `application/queries.ts#todayDateString` computes it (`bangkokDateString()`,
 * the Asia/Bangkok calendar date), so the seeded shift_assignments
 * land inside the Control Hub's "today" window (`useHubMetrics` /
 * `useTodayAttendance`) the moment the seed finishes.
 *
 * Quota reconciliation (job 1, "ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC",
 * quota 6): 2 volunteers currently hold an accepted slot (v1 standby, v2
 * checked_in; v3 completed is historical), 1 volunteer holds an
 * outstanding dispatch offer (v4, `dispatch_status: 'dispatched'` →
 * `slots_dispatched = 1`), leaving `slots_remaining = 3` — `2 + 1 + 3 = 6 =
 * quota`, satisfying `quota.ts#assertQuotaInvariant`. Jobs 2/3 seed no
 * assignments/applications, so their default `makeJob` slots
 * (`0 confirmed + 0 dispatched + quota remaining`) already satisfy the
 * invariant untouched.
 *
 * Like `seedShelter` (and unlike the ULID-keyed-but-existence-checked
 * `seedShelter2`), every doc here is minted with a ULID `_id` and this
 * function performs no "already seeded" guard — re-running `pnpm seed` adds
 * another batch, matching the documented convention at the top of this file.
 */
async function seedVolunteers(master: MasterLookup): Promise<void> {
	await ensureDb(SHELTER_DB);

	// "Today" — Asia/Bangkok calendar date, matching
	// `application/queries.ts#todayDateString` exactly (the Control Hub /
	// attendance tab query by this same string).
	const today = bangkokDateString();
	// The 16:00–00:00 shift ends after midnight, so it carries the next day.
	const tomorrow = bangkokDateString(new Date(Date.now() + 86_400_000));

	function dutyWindowFor(shift: ShiftKind) {
		const window = resolveDutyWindow(today, shift);
		if (!window) throw new Error(`seedVolunteers: resolveDutyWindow(${today}, ${shift}) was null`);
		return window;
	}

	// — jobs ————————————————————————————————————————————————————————————————————
	const jobInputs: JobInput[] = [
		{
			title: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC',
			description:
				'ต้อนรับและอำนวยความสะดวกผู้ประสานงานหน่วยงานภายนอกที่มาติดต่อศูนย์ประสานงานเหตุฉุกเฉิน (EOC) ' +
				'พร้อมประสานงานส่งต่อคำร้องไปยังฝ่ายที่เกี่ยวข้อง แต่งกายสุภาพ พูดจาดี ไม่จำเป็นต้องมีประสบการณ์',
			tier: 'operational',
			required_roles: [],
			// CR-100 — jobs store the master_data `volunteer_skills` code, not the label.
			skills_required: masterCodes(master, 'volunteer_skills', 'reception'),
			// schema_v 3 — capacity lives in the sub-shifts; quota = 3 + 3 = 6.
			shifts: [
				{
					id: `js-${today}-a`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '16:00',
					quota: 3
				},
				{
					id: `js-${today}-b`,
					date: today,
					end_date: tomorrow,
					start_time: '16:00',
					end_time: '00:00',
					quota: 3
				}
			],
			auto_accept: false,
			is_urgent: true
		},
		{
			title: 'เจ้าหน้าที่คัดกรองผู้ประสบภัย (Registration & Screening)',
			description:
				'ช่วยคีย์ข้อมูลลงทะเบียนผู้ประสบภัยเข้าศูนย์และคัดกรองอาการเบื้องต้นผ่านระบบ ต้องมีสิทธิ์เข้าระบบ ' +
				'(staff-capable) และผ่านการอบรมการใช้งานระบบลงทะเบียนก่อนเริ่มปฏิบัติงาน',
			tier: 'staff-capable',
			required_roles: ['registration_staff'],
			skills_required: masterCodes(master, 'volunteer_skills', 'screening'),
			shifts: [
				{
					id: `js-${today}-c`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '17:00',
					quota: 3
				}
			],
			auto_accept: false,
			is_urgent: false
		},
		{
			title: 'ทีมพลาธิการช่วยยกของ (Heavy Lifting)',
			description:
				'ช่วยขนย้ายของบริจาคและเสบียงระหว่างจุดพักของกับคลังศูนย์ ต้องมีร่างกายแข็งแรง ' +
				'สามารถยกของหนักได้ต่อเนื่อง ปิดรับสมัครชั่วคราวจนกว่าจะเปิดรับรอบถัดไป',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'logistics'),
			shifts: [
				{
					id: `js-${today}-d`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '16:00',
					quota: 8
				}
			],
			auto_accept: false,
			is_urgent: false
		},
		{
			title: 'ทีมครัวกลางและจัดเตรียมอาหารกล่องพระราชทาน',
			description:
				'ช่วยประกอบอาหาร บรรจุกล่อง และจัดเตรียมเสบียงอาหารปรุงสุกสำหรับแจกจ่ายผู้ประสบภัยในศูนย์พักพิง',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'cooking'),
			shifts: [
				{
					id: `js-${today}-e1`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '12:00',
					quota: 10
				},
				{
					id: `js-${today}-e2`,
					date: today,
					end_date: today,
					start_time: '12:00',
					end_time: '18:00',
					quota: 15
				}
			],
			auto_accept: true,
			is_urgent: true
		},
		{
			title: 'ทีมแพทย์และพยาบาลประจำจุดปฐมพยาบาล',
			description:
				'ดูแลผู้ป่วยเบื้องต้น ตรวจวัดสัญญาณชีพ และจ่ายยาสามัญประจำบ้านสำหรับผู้ประสบภัยในศูนย์',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'medical'),
			shifts: [
				{
					id: `js-${today}-f`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '16:00',
					quota: 4
				}
			],
			auto_accept: false,
			is_urgent: true
		},
		{
			title: 'ทีมคลังพัสดุและขนย้ายถุงยังชีพฉุกเฉิน',
			description:
				'จัดเรียงสิ่งของบริจาค ตรวจนับสต็อก และแพ็คถุงยังชีพเพื่อส่งมอบให้ผู้ประสบภัยตามโซนต่างๆ',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'logistics'),
			shifts: [
				{
					id: `js-${today}-g`,
					date: today,
					end_date: today,
					start_time: '13:00',
					end_time: '17:00',
					quota: 8
				}
			],
			auto_accept: false,
			is_urgent: false
		}
	];
	const [job1, job2, job3, job4, job5, job6] = jobInputs.map((j) => makeJob(j, ctx));

	// job1: `open` + urgent, quota reconciled against the 4 shift_assignments
	// below (see the docblock invariant walkthrough above).
	job1.status = 'open';
	job1.slots_confirmed = 2;
	job1.slots_dispatched = 1;
	job1.slots_remaining = 3;
	// job2: `open` staff-capable
	job2.status = 'open';
	// job3: `paused` — temporarily not accepting, quota still fully unclaimed.
	job3.status = 'paused';
	// job4, job5, job6: `open`
	job4.status = 'open';
	job5.status = 'open';
	job6.status = 'open';
	for (const j of [job1, job2, job3, job4, job5, job6]) jobSchema.parse(j);

	// — volunteers ————————————————————————————————————————————————————————————
	// `source` covers all 4 enum values across the 5 profiles (public_apply
	// repeats once); `identity_verified` mixes true/false; v5 carries a
	// controlled skill (การแพทย์/ปฐมพยาบาล) and is left unverified — her
	// job_application below lands on `pending_review`, never `confirmed`
	// (`skills.ts#initialStatusForSkills`).
	const volunteerCodes: string[] = [];
	function mintVolunteerCode(): string {
		const c = nextVolunteerCode(volunteerCodes);
		volunteerCodes.push(c);
		return c;
	}

	const v1Input: VolunteerInput = {
		first_name: 'อรุณ',
		last_name: 'ใจกล้า',
		nickname: 'อรุณ',
		phone: '0821111111',
		email: null,
		// `volunteer.skills` keeps storing LABELS (CR-100 leaves this field alone) —
		// same master item as job1's `skills_required` code above.
		skills: masterLabels(master, 'volunteer_skills', 'reception'),
		organization: null,
		national_id: null,
		source: 'public_apply'
	};
	const v2Input: VolunteerInput = {
		first_name: 'สมพงษ์',
		last_name: 'ยิ้มแย้ม',
		phone: '0822222222',
		email: null,
		skills: masterLabels(master, 'volunteer_skills', 'cooking', 'logistics'),
		organization: null,
		national_id: null,
		source: 'walk_in'
	};
	const v3Input: VolunteerInput = {
		first_name: 'ปิยะดา',
		last_name: 'คงมั่น',
		phone: '0823333333',
		email: null,
		skills: masterLabels(master, 'volunteer_skills', 'transport'),
		organization: 'มูลนิธิกู้ภัยหาดใหญ่',
		national_id: null,
		source: 'staff_entry'
	};
	const v4Input: VolunteerInput = {
		first_name: 'วราภรณ์',
		last_name: 'ศรีสุข',
		phone: '0824444444',
		email: null,
		skills: masterLabels(master, 'volunteer_skills', 'logistics'),
		organization: null,
		national_id: null,
		source: 'transfer'
	};
	const v5Input: VolunteerInput = {
		first_name: 'สุนิสา',
		last_name: 'แพทย์ทอง',
		nickname: 'หมอนิด',
		phone: '0825555555',
		email: null,
		// The master's own controlled item — this is what makes `initialStatusForSkills`
		// hold the seeded application at `pending_review`.
		skills: masterLabels(master, 'volunteer_skills', 'medical'),
		organization: 'รพ.สต. บ้านพรุ',
		national_id: null,
		source: 'public_apply'
	};

	const v1 = makeVolunteer(v1Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v2 = makeVolunteer(v2Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v3 = makeVolunteer(v3Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v4 = makeVolunteer(v4Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v5 = makeVolunteer(v5Input, ctx, { volunteer_code: mintVolunteerCode() });

	// identity_verified mix — `makeVolunteer` always mints `false` (CR-094 §6
	// default); flip the 3 already-vetted profiles here.
	v1.identity_verified = true;
	v3.identity_verified = true;
	v4.identity_verified = true;
	// v2, v5 stay unverified — v5 doubles as the "controlled skill, not yet
	// approved" fixture required by 00-foundation.md §00.5.

	// v2 is presently on-shift (see shift_assignment a2 below) — reflects the
	// live flag `useCheckIn` would have set.
	v2.checked_in = true;
	v2.current_shelter_code = SH001_CODE;

	for (const v of [v1, v2, v3, v4, v5]) volunteerSchema.parse(v);

	// — shift_assignments ————————————————————————————————————————————————————
	// All 4 against job1 (the `open` job), dated "today" so the Control Hub /
	// attendance tab show non-zero counts immediately after seeding.
	const a1Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-a`,
		volunteer_id: v1._id,
		date: today,
		shift: 'morning',
		station: 'จุดต้อนรับ',
		duty_window: dutyWindowFor('morning')
	};
	const a2Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-a`,
		volunteer_id: v2._id,
		date: today,
		shift: 'morning',
		station: 'ครัว',
		duty_window: dutyWindowFor('morning')
	};
	const a3Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-b`,
		volunteer_id: v3._id,
		date: today,
		shift: 'night',
		station: 'จุดตรวจ',
		duty_window: dutyWindowFor('night')
	};
	const a4Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-b`,
		volunteer_id: v4._id,
		date: today,
		shift: 'afternoon',
		station: 'พลาธิการ',
		duty_window: dutyWindowFor('afternoon')
	};

	// a1 — accepted, standing by before the shift starts.
	const a1 = makeShiftAssignment(a1Input, ctx, { status: 'standby' });
	// a2 — currently checked in (mirrors v2.checked_in above).
	const a2 = makeShiftAssignment(a2Input, ctx, {
		status: 'checked_in',
		check_in_at: now(),
		check_in_by: 'seed'
	});
	// a3 — finished an earlier shift today; check-in AND check-out both set.
	const a3 = makeShiftAssignment(a3Input, ctx, {
		status: 'completed',
		check_in_at: now(),
		check_in_by: 'seed'
	});
	a3.check_out_at = now();
	// a4 — dispatch offer outstanding, not yet accepted/declined
	// (`dispatch_status: 'dispatched'` ↔ job1.slots_dispatched = 1 above).
	const a4 = makeShiftAssignment(a4Input, ctx, {
		status: 'assigned',
		dispatch_status: 'dispatched'
	});

	for (const a of [a1, a2, a3, a4]) shiftAssignmentSchema.parse(a);

	// — job_applications ————————————————————————————————————————————————————
	const confirmedApplicationInput: JobApplicationInput = {
		job_id: job1._id,
		volunteer_id: v1._id,
		applicant: {
			first_name: v1.first_name,
			last_name: v1.last_name,
			phone: v1.phone ?? '',
			phone_hash: 'mock-hash-v-001',
			email: v1.email ?? null,
			skills: v1.skills,
			national_id: v1.national_id ?? null
		},
		selected_shift: {
			shift_id: `js-${today}-a`,
			date: today,
			start_time: '08:00',
			end_time: '16:00'
		},
		tracking_token: ulid()
	};
	const confirmedApplication = makeJobApplication(confirmedApplicationInput, ctx, 'confirmed');
	confirmedApplication.reviewed_at = now();
	confirmedApplication.reviewed_by = 'seed';
	confirmedApplication.review_notes = 'ตรวจสอบแล้ว ทักษะตรงตามที่ต้องการ อนุมัติเข้าปฏิบัติงาน';

	// v5's controlled skill (การแพทย์/ปฐมพยาบาล) forces `pending_review` even
	// though job1.auto_accept is false anyway (skills.ts#initialStatusForSkills).
	const pendingApplicationInput: JobApplicationInput = {
		job_id: job1._id,
		volunteer_id: v5._id,
		applicant: {
			first_name: v5.first_name,
			last_name: v5.last_name,
			phone: v5.phone ?? '',
			phone_hash: 'mock-hash-v-005',
			email: v5.email ?? null,
			skills: v5.skills,
			national_id: v5.national_id ?? null
		},
		selected_shift: {
			shift_id: `js-${today}-a`,
			date: today,
			start_time: '08:00',
			end_time: '16:00'
		},
		tracking_token: ulid()
	};
	const pendingStatus = initialStatusForSkills(v5.skills, {
		auto_accept: job1.auto_accept,
		tier: job1.tier
	});
	const pendingApplication = makeJobApplication(pendingApplicationInput, ctx, pendingStatus);

	for (const app of [confirmedApplication, pendingApplication]) jobApplicationSchema.parse(app);

	const allDocs = [
		job1,
		job2,
		job3,
		job4,
		job5,
		job6,
		v1,
		v2,
		v3,
		v4,
		v5,
		a1,
		a2,
		a3,
		a4,
		confirmedApplication,
		pendingApplication
	];
	await bulkDocs(SHELTER_DB, allDocs);

	console.log(
		`  ✓ ${SHELTER_DB}: 6 jobs, 5 volunteers, 4 shift_assignments, 2 job_applications (today=${today})`
	);
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
		console.log(
			`  ✓ ${SHELTER_DB}: ${records.length} daily_calc snapshots seeded (CR-042 have map, mock historical occupancy, real engine ${FORMULA_V})`
		);
	} catch {
		console.log(`  ✓ ${SHELTER_DB}: daily_calc snapshots already present, skipping`);
	}
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

/**
 * Volunteer Job Board fixtures (CR-092 / T-28) for SH001 + SH002.
 *
 * Without these the public board at `/volunteers/jobs` is empty on a fresh database
 * and there is no way to fill it: the back-office screen that posts a job is T-29 and
 * does not exist yet, so the only alternative is hand-writing docs into CouchDB.
 *
 * Deliberately spans the three outcomes the apply flow can produce, because each takes
 * a different path through `_needs_review` and the slot counter:
 *
 * - `auto_accept` operational → confirmed ticket, takes a slot
 * - `staff-capable` → always queued for review whatever the flag says (F-AUTO)
 * - a controlled skill (พยาบาล) → queued even on an auto-accept operational job
 *
 * No `job_application` fixtures: an application must own a `tracking_token` its
 * applicant holds, and seeding one would either invent a token nobody has or leave a
 * ticket that cannot be opened. Apply through the UI to create them.
 */
async function seedVolunteerJobs(master: MasterLookup): Promise<void> {
	await ensureDb(SHELTER_DB);
	await ensureDb(SHELTER_DB_2);

	const jobs: { db: string; ctx: AuthorContext; body: Record<string, unknown> }[] = [
		{
			db: SHELTER_DB,
			ctx: SH001_CTX,
			body: {
				title: 'ผู้ช่วยครัวจัดเตรียมอาหาร',
				description:
					'ช่วยเตรียมวัตถุดิบ ปรุงอาหาร และแจกจ่ายอาหารกลางวันให้ผู้ประสบภัย แต่งกายสุภาพ สวมรองเท้าหุ้มส้น',
				tier: 'operational',
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'cooking'),
				quota: 8,
				slots_confirmed: 0,
				slots_dispatched: 0,
				shift_template: {
					shift_name: 'เช้า',
					start_time: '08:00',
					end_time: '12:00',
					days: ['mon', 'tue', 'wed', 'thu', 'fri']
				},
				auto_accept: true,
				status: 'open'
			}
		},
		{
			db: SHELTER_DB,
			ctx: SH001_CTX,
			body: {
				title: 'ทีมยกของและจัดเรียงคลังสิ่งของบริจาค',
				description: 'ขนย้ายและจัดเรียงสิ่งของบริจาคเข้าคลัง ต้องยกของหนักได้',
				tier: 'operational',
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'logistics'),
				quota: 6,
				// Zero, like every other fixture. A non-zero count here would not show up on
				// the board: the public plane reads head count from the atomic VolunteerJobSlot
				// counter, which starts at zero and only moves when somebody applies. Seeding
				// `slots_confirmed: 4` looked like a filled job but rendered as an empty one.
				// Fill this bar by applying through the UI — that exercises the real path.
				slots_confirmed: 0,
				slots_dispatched: 0,
				shift_template: {
					shift_name: 'บ่าย',
					start_time: '13:00',
					end_time: '17:00',
					days: ['sat', 'sun']
				},
				auto_accept: true,
				status: 'open'
			}
		},
		{
			db: SHELTER_DB,
			ctx: SH001_CTX,
			body: {
				title: 'พยาบาลอาสาประจำจุดปฐมพยาบาล',
				description: 'ดูแลจุดปฐมพยาบาล คัดกรองอาการเบื้องต้น ต้องมีใบประกอบวิชาชีพ',
				tier: 'operational',
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'medical'),
				quota: 4,
				slots_confirmed: 0,
				slots_dispatched: 0,
				shift_template: {
					shift_name: 'เช้า',
					start_time: '08:00',
					end_time: '16:00',
					days: ['mon', 'wed', 'fri']
				},
				// On, so that a review still happens purely because of the controlled
				// skill — the licence is checked by a person, not by a flag.
				auto_accept: true,
				status: 'open'
			}
		},
		{
			db: SHELTER_DB_2,
			ctx: CTX_2,
			body: {
				title: 'เจ้าหน้าที่ช่วยลงทะเบียนผู้ประสบภัย',
				description:
					'ช่วยคีย์ข้อมูลผู้อพยพเข้าระบบที่จุดลงทะเบียน ได้สิทธิ์บันทึกข้อมูลเฉพาะช่วงเวลากะที่เช็คอินแล้ว',
				tier: 'staff-capable',
				required_roles: ['registration_staff'],
				skills_required: masterCodes(master, 'volunteer_skills', 'screening'),
				quota: 3,
				slots_confirmed: 0,
				slots_dispatched: 0,
				shift_template: {
					shift_name: 'เช้า',
					start_time: '09:00',
					end_time: '15:00',
					days: ['mon', 'tue', 'wed', 'thu', 'fri']
				},
				// F-AUTO forbids auto-accept on staff-capable; the API enforces it too,
				// but a fixture that contradicted the rule would be a misleading example.
				auto_accept: false,
				status: 'open'
			}
		},
		{
			db: SHELTER_DB_2,
			ctx: CTX_2,
			body: {
				title: 'อาสาสมัครดูแลเด็กและกิจกรรมสันทนาการ',
				description: 'จัดกิจกรรมให้เด็กในศูนย์พักพิงช่วงเย็น',
				tier: 'operational',
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'childcare'),
				quota: 5,
				slots_confirmed: 0,
				slots_dispatched: 0,
				shift_template: {
					shift_name: 'เย็น',
					start_time: '16:00',
					end_time: '19:00',
					days: ['sat', 'sun']
				},
				auto_accept: true,
				status: 'open'
			}
		}
	];

	for (const [index, job] of jobs.entries()) {
		// Fixed ids so re-running the seed updates these jobs instead of posting a
		// second copy of every one — a ULID per run would multiply the board.
		const id = `seedjob${String(index + 1).padStart(3, '0')}`;
		await putDoc(job.db, makeDoc('job', 1, job.body, job.ctx, id));
	}

	console.log(`  ✓ volunteer jobs: ${jobs.length} postings across SH001 + SH002`);
}

/**
 * A rostered volunteer for the Access Portal (CR-092 หน้าจอ 6 / T-28).
 *
 * `shift_assignment` is what ตารางทำงานจิตอาสา reads, and nothing can create one yet:
 * the screen that rosters people is the Dispatch Workspace in T-29. Without a fixture
 * the schedule is empty on a fresh database with no way to fill it.
 *
 * Sign in to the portal with **0891112222** to see these.
 *
 * The profile is seeded alongside because the worker reads `volunteer.phone_hash` when
 * projecting an assignment — that hash is the only route from a phone number to a
 * schedule, so an assignment whose volunteer is missing projects unreachable.
 */
async function seedVolunteerSchedule(master: MasterLookup): Promise<void> {
	await ensureDb(SHELTER_DB);

	const phone = '0891112222';
	const volunteerId = 'seedvol001';
	// Typed as a Record so makeDoc's result keeps the index signature putDoc expects —
	// an object literal narrows to an exact shape that no longer matches it.
	const volunteerBody: Record<string, unknown> = {
		first_name: 'อาสา',
		last_name: 'ทดสอบ',
		phone,
		phone_hash: await sha256Hex(phone),
		email: null,
		// `volunteer.skills` stores labels (CR-100) — read from the seeded master items
		// so a renamed skill stays in sync instead of drifting into free text.
		skills: masterLabels(master, 'volunteer_skills', 'cooking', 'logistics'),
		organization: null,
		tracking_token: null,
		status: 'active',
		user_name: null,
		central_profile_id: `volunteer:${volunteerId}`,
		checked_in: false,
		current_shelter_code: null
	};
	await putDoc(SHELTER_DB, makeDoc('volunteer', 1, volunteerBody, SH001_CTX, volunteerId));

	// Relative to today so the fixture does not rot into a schedule of past shifts.
	const day = (offset: number) => {
		const d = new Date();
		d.setDate(d.getDate() + offset);
		return d.toISOString().slice(0, 10);
	};
	const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

	const shifts = [
		{
			id: 'seedshift001',
			date: day(1),
			station: 'ครัวกลาง',
			start: '01:00',
			end: '05:00',
			status: 'assigned',
			// Awaiting the volunteer's answer — this is what renders the Dispatch Card
			// with its accept / decline buttons.
			dispatch_status: 'dispatched',
			// The code a manager reads out over the phone. Fixed so the flow can be walked
			// through; real ones are minted when the shift is offered. Every character is
			// from the spoken alphabet — no 0/1/I/L/O/U, which is why it is not `SEED-01`.
			response_code: 'SEED-99'
		},
		{
			id: 'seedshift002',
			date: day(3),
			station: 'จุดลงทะเบียน',
			start: '02:00',
			end: '08:00',
			status: 'standby',
			dispatch_status: 'accepted'
		},
		{
			id: 'seedshift003',
			date: day(-2),
			station: 'คลังสิ่งของ',
			start: '01:00',
			end: '05:00',
			// A finished shift, so the portal has both an upcoming and a past entry to lay out.
			status: 'completed',
			dispatch_status: 'accepted'
		}
	];

	for (const shift of shifts) {
		const body: Record<string, unknown> = {
			job_id: 'job:seedjob001',
			volunteer_id: `volunteer:${volunteerId}`,
			date: shift.date,
			shift: 'custom',
			station: shift.station,
			duty_window: {
				start_ts: at(shift.date, shift.start),
				end_ts: at(shift.date, shift.end)
			},
			check_in_at: shift.status === 'completed' ? at(shift.date, shift.start) : null,
			check_out_at: shift.status === 'completed' ? at(shift.date, shift.end) : null,
			check_in_by: shift.status === 'completed' ? 'seed' : null,
			status: shift.status,
			dispatch_status: shift.dispatch_status,
			response_code: shift.response_code ?? null,
			responded_at: null
		};
		await putDoc(SHELTER_DB, makeDoc('shift_assignment', 2, body, SH001_CTX, shift.id));
	}

	console.log(
		`  ✓ volunteer schedule: 1 profile + ${shifts.length} shifts (login ${phone}, offer code SEED-99)`
	);
}

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
		await seedCatalogFoodSphereParameters();
		await seedShelter(master);
		await seedShelter2(master);
		await seedVolunteers(master);
		await seedDashboardData(master);
		// Before seedDailyCalc: that step refuses to run against a database that already
		// holds its deterministic snapshots, and it must not take the job board down with
		// it on a re-seed. This one is idempotent — fixed ids, existing docs left alone.
		await seedVolunteerJobs(master);
		await seedVolunteerSchedule(master);
		await seedDailyCalc();
		console.log('\nDone.\n');
	} catch (e: unknown) {
		console.error('\nSeed failed:', e);
		process.exit(1);
	}
}

main();
