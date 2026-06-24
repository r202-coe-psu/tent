/**
/**
 * Migration script: shelter master doc v2 → current (CR-008)
 *
 * Usage:  pnpm migrate:shelter  (from frontend/)
 * Needs:  CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 *
 * Idempotent — safe to re-run. Only updates docs with `schema_v < 3`.
 * Dry-run by default (--write to apply).
 *
 * Migration mapping (per docs/data/schema.md §3.1):
 * - Shelter-level:
 *   - status 'open' → operation_status 'active'
 *   - status 'closed' → operation_status 'closed'
 *   - shelter_type: null
 *   - area_type: null
 *   - facilities.car_toilet_accessible: null
 *   - common_areas: { central_kitchen: null, helipad: null, parking_capacity: null, sub_storage: [] }
 *   - utilities: { power_source: null, water_source: null, communications: [], vhf_channel: null }
 *   - risk: { elevation_m: null, entrance_description: null, constraints: null }
 * - Zone-level:
 *   - type: 'general'
 *   - status: 'active'
 *   - closed_at: null
 *   - closed_by: null
 *   - reason: null
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');

// ─── env loader ─────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
	const envPath = resolve(ROOT, '.env');
	if (!existsSync(envPath)) return {};
	const text = readFileSync(envPath, 'utf-8');
	return Object.fromEntries(
		text
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#') && l.includes('='))
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
const rawCouchUrl = env.COUCHDB_ADMIN_URL ?? 'http://admin:password@localhost:5984';

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

// ─── CouchDB helpers ────────────────────────────────────────────────────────

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
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	return { status: res.status, data };
}

// ─── Migration logic ────────────────────────────────────────────────────────

interface ShelterMasterV2 {
	_id: string;
	_rev?: string;
	type: string;
	schema_v: number;
	code: string;
	name: string;
	zones?: Array<{
		code: string;
		name: string;
		capacity: number;
	}>;
	items?: unknown;
	rules?: unknown;
	sops?: unknown;
	status: string;
	capacity?: number;
	area_m2?: number | null;
	facilities?: {
		toilets_female?: number;
		toilets_male?: number;
		toilets_accessible?: number;
		showers?: number;
		water_points?: number;
		handwashing_stations?: number;
	};
	location?: { address?: string; lat?: number; lng?: number };
	contact?: { name?: string; phone?: string };
	opened_at?: string;
	closed_at?: string | null;
	created_at: string;
	updated_at: string;
}

interface ShelterMaster extends Omit<
	ShelterMasterV2,
	'status' | 'zones' | 'items' | 'rules' | 'sops' | 'facilities'
> {
	schema_v: 3;
	operation_status: 'standby' | 'active' | 'full_capacity' | 'closed';
	shelter_type: string | null;
	area_type: string | null;
	facilities: {
		toilets_male: number | null;
		toilets_female: number | null;
		toilets_accessible: number | null;
		showers: number | null;
		water_points: number | null;
		handwashing_stations: number | null;
		car_toilet_accessible: boolean | null;
	};
	common_areas: {
		central_kitchen: boolean | null;
		helipad: boolean | null;
		parking_capacity: number | null;
		sub_storage: Array<{
			name: string;
			type: 'general' | 'food_dry' | 'drinking_water' | 'medical_supplies';
		}>;
	};
	utilities: {
		power_source: 'city_grid' | 'generator' | 'solar' | null;
		water_source: 'city_water' | 'water_tank' | 'groundwater' | null;
		communications: Array<'cellular' | 'wifi' | 'vhf_radio'>;
		vhf_channel: string | null;
	};
	risk: {
		elevation_m: number | null;
		entrance_description: string | null;
		constraints: string | null;
	};
	zones: Array<{
		code: string;
		name: string;
		capacity: number;
		type: 'general' | 'male' | 'female' | 'vulnerable' | 'pet' | 'quarantine';
		status: 'active' | 'closed';
		closed_at: string | null;
		closed_by: string | null;
		reason: string | null;
	}>;
}

function migrateV2ToCurrent(master: ShelterMasterV2): ShelterMaster {
	if (master.schema_v >= 3) return master as unknown as ShelterMaster;

	const v3: ShelterMaster = {
		...master,
		schema_v: 3,
		operation_status:
			master.status === 'open' ? 'active' : (master.status as ShelterMaster['operation_status']),
		shelter_type: null,
		area_type: null,
		capacity: master.capacity ?? 0,
		facilities: {
			toilets_male: master.facilities?.toilets_male ?? null,
			toilets_female: master.facilities?.toilets_female ?? null,
			toilets_accessible: master.facilities?.toilets_accessible ?? null,
			showers: master.facilities?.showers ?? null,
			water_points: master.facilities?.water_points ?? null,
			handwashing_stations: master.facilities?.handwashing_stations ?? null,
			car_toilet_accessible: null
		},
		common_areas: {
			central_kitchen: null,
			helipad: null,
			parking_capacity: null,
			sub_storage: []
		},
		utilities: {
			power_source: null,
			water_source: null,
			communications: [],
			vhf_channel: null
		},
		risk: {
			elevation_m: null,
			entrance_description: null,
			constraints: null
		},
		zones: (master.zones ?? []).map((z) => ({
			...z,
			type: 'general' as const,
			status: 'active' as const,
			closed_at: null,
			closed_by: null,
			reason: null
		}))
	};
	// Drop v2-only fields (items/rules/sops not in v3)
	delete (v3 as unknown as Record<string, unknown>).items;
	delete (v3 as unknown as Record<string, unknown>).rules;
	delete (v3 as unknown as Record<string, unknown>).sops;
	delete (v3 as unknown as Record<string, unknown>).status;
	return v3;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--write');
const REGISTRY_DB = 'registry';

async function main() {
	console.log(`🔄 Shelter master v2 → current migration`);
	console.log(`   COUCH: ${COUCH_URL}`);
	console.log(`   mode: ${DRY_RUN ? 'DRY-RUN (pass --write to apply)' : 'WRITE'}`);
	console.log('');

	// Ensure registry db exists
	const createRes = await couchReq('PUT', `/${REGISTRY_DB}`);
	console.log(
		`✓ registry db: ${createRes.status === 201 || createRes.status === 412 ? 'ok' : createRes.status}`
	);

	// List all shelter master docs
	const listRes = await couchReq('GET', `/${REGISTRY_DB}/_all_docs?include_docs=true`);
	if (listRes.status === 404) {
		console.log('⚠️  registry db not found — no shelters to migrate');
		return;
	}
	if (listRes.status >= 400) {
		console.error('✗ Failed to list registry docs:', listRes.status, listRes.data);
		process.exit(1);
	}

	const rows = (listRes.data as { rows?: Array<{ id: string; doc: ShelterMasterV2 }> })?.rows ?? [];
	const shelterMasters = rows.filter(
		(r) => r.id.startsWith('shelter:') && r.doc && r.doc.type === 'shelter'
	);

	console.log(`📋 Found ${shelterMasters.length} shelter master doc(s)`);
	console.log('');

	let migrated = 0;
	let skipped = 0;
	let failed = 0;

	for (const row of shelterMasters) {
		const v2 = row.doc;
		if (v2.schema_v >= 3) {
			console.log(`  ⊘ ${v2.code} (${row.id}) — already v3, skip`);
			skipped++;
			continue;
		}

		const v3 = migrateV2ToCurrent(v2);

		console.log(`  → ${v2.code} (${row.id}) v${v2.schema_v} → current`);
		console.log(`    operation_status: ${v2.status} → ${v3.operation_status}`);
		console.log(`    zones: ${v2.zones?.length ?? 0} (all set to type=general, status=active)`);
		console.log(`    facilities: add car_toilet_accessible=null`);
		console.log(`    common_areas: empty object`);
		console.log(`    utilities: empty object`);
		console.log(`    risk: empty object`);

		if (!DRY_RUN) {
			try {
				const putRes = await couchReq('PUT', `/${REGISTRY_DB}/${encodeURIComponent(row.id)}`, v3);
				if (putRes.status >= 400) {
					console.error(`    ✗ write failed: ${putRes.status}`, putRes.data);
					failed++;
				} else {
					console.log(`    ✓ written (${putRes.status})`);
					migrated++;
				}
			} catch (e) {
				console.error(`    ✗ error:`, e);
				failed++;
			}
		} else {
			migrated++;
		}
	}

	console.log('');
	console.log(`📊 Summary:`);
	console.log(`   migrated: ${migrated}`);
	console.log(`   skipped (already v3): ${skipped}`);
	console.log(`   failed: ${failed}`);
	if (DRY_RUN && migrated > 0) {
		console.log('');
		console.log('💡 Re-run with --write to apply');
	}
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(1);
});
