/**
 * Synchronize central CouchDB databases (registry, catalog, thailand_locations)
 *
 * Ensures:
 * 1. Central databases exist (registry, catalog, thailand_locations)
 * 2. Database security (_security) on registry and catalog
 * 3. Access control design doc (_design/access) on catalog (VDU for system_admin only)
 * 4. Mango indexes on thailand_locations (province_id, district_id)
 * 5. Baseline master SOP ratio profile (sop_profile:master_sphere_baseline) if missing
 *
 * Fast and idempotent (<1 second). Safe to run on every CI/CD deployment.
 *
 * Usage (from frontend/):
 *   pnpm sync:central                 # dry-run
 *   pnpm sync:central --write --confirm
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	createInitialProfile,
	SOP_MASTER_SCHEMA_VERSION,
	sopMasterSchema
} from '$lib/features/sop-ratios/domain/sop-ratio';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';
import { FALLBACK_UNIT_DEFINITIONS } from '$lib/features/catalog/domain/unit-of-measure';

// ─── env loader ─────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
	const envPath = resolve(process.cwd(), '.env');
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
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL;

if (!rawCouchUrl) {
	console.error('✗ COUCHDB_ADMIN_URL is not set');
	console.error('  Set it in the environment or frontend/.env');
	console.error('  Format: http://admin:<password>@<host>:<port>');
	process.exit(1);
}

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

const DRY_RUN = !process.argv.includes('--write');
const CONFIRMED = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRMED) {
	console.error('✗ --write requires --confirm (a typo could write to production)');
	console.error('  Re-run with: pnpm sync:central --write --confirm');
	process.exit(1);
}

// ─── CouchDB helpers ────────────────────────────────────────────────────────

async function couchReq(
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json'
	};
	if (COUCH_AUTH) headers['Authorization'] = COUCH_AUTH;
	const res = await fetch(`${COUCH_URL}${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	return { status: res.status, data };
}

interface CouchDbSecurity {
	admins?: { names?: string[]; roles?: string[] };
	members?: { names?: string[]; roles?: string[] };
}

async function ensureDb(name: string, dryRun: boolean): Promise<'created' | 'existing'> {
	const existing = await couchReq('GET', `/${name}`);
	if (existing.status === 200) return 'existing';
	if (existing.status !== 404) {
		throw new Error(`Failed to check database "${name}" (HTTP ${existing.status})`);
	}
	if (dryRun) return 'created';

	const res = await couchReq('PUT', `/${name}`);
	if (res.status !== 201 && res.status !== 412) {
		throw new Error(`Cannot create database "${name}" (HTTP ${res.status})`);
	}
	return 'created';
}

async function syncSecurity(
	db: string,
	security: CouchDbSecurity,
	dryRun: boolean
): Promise<'already_current' | 'updated'> {
	const { status, data } = await couchReq('GET', `/${db}/_security`);
	const existing = (status === 200 ? data : {}) as CouchDbSecurity;

	const existingAdminsRoles = new Set(existing.admins?.roles ?? []);
	const existingAdminsNames = new Set(existing.admins?.names ?? []);
	const existingMembersRoles = new Set(existing.members?.roles ?? []);
	const existingMembersNames = new Set(existing.members?.names ?? []);

	const needsAdminsRoles = (security.admins?.roles ?? []).some((r) => !existingAdminsRoles.has(r));
	const needsAdminsNames = (security.admins?.names ?? []).some((n) => !existingAdminsNames.has(n));
	const needsMembersRoles = (security.members?.roles ?? []).some(
		(r) => !existingMembersRoles.has(r)
	);
	const needsMembersNames = (security.members?.names ?? []).some(
		(n) => !existingMembersNames.has(n)
	);

	if (!needsAdminsRoles && !needsAdminsNames && !needsMembersRoles && !needsMembersNames) {
		return 'already_current';
	}

	if (dryRun) return 'updated';

	const merge = (a: string[] = [], b: string[] = []) => Array.from(new Set([...a, ...b]));
	const merged: CouchDbSecurity = {
		admins: {
			roles: merge(existing.admins?.roles, security.admins?.roles),
			names: merge(existing.admins?.names, security.admins?.names)
		},
		members: {
			roles: merge(existing.members?.roles, security.members?.roles),
			names: merge(existing.members?.names, security.members?.names)
		}
	};

	const putRes = await couchReq('PUT', `/${db}/_security`, merged);
	if (putRes.status >= 400) {
		throw new Error(`Cannot set _security for "${db}" (HTTP ${putRes.status})`);
	}
	return 'updated';
}

async function syncCatalogAccessDesign(
	dryRun: boolean
): Promise<'already_current' | 'created' | 'updated'> {
	const validateFn = `function (newDoc, oldDoc, userCtx) {
  function isUnitCode(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9_]{0,15}$/.test(value);
  }
  function isLegacyUnitLabel(value) {
    return typeof value === 'string' && [
      'ชิ้น', 'หน่วย', 'อัน', 'ตัว', 'ชุด', 'คู่', 'กล่อง', 'แพ็ค', 'ถุง', 'ซอง',
      'ขวด', 'กระป๋อง', 'เม็ด', 'ก้อน', 'หลอด', 'ม้วน', 'แผ่น', 'ผืน', 'ห่อ', 'ฟอง',
      'ผล', 'แกลลอน', 'ถัง', 'กรัม', 'กิโลกรัม', 'กก', 'กก.', 'มิลลิลิตร', 'ลิตร', 'เมตร'
    ].indexOf(value.trim()) !== -1;
  }
  function validateUnitField(value, field) {
    if (value && !isUnitCode(value)) {
      throw({ forbidden: field + ' must match ^[a-z][a-z0-9_]{0,15}$' });
    }
  }
  if (userCtx.roles.indexOf('_admin') !== -1 || userCtx.roles.indexOf('system_admin') !== -1) {
    if (newDoc._deleted && oldDoc && oldDoc.type === 'unit_of_measure' && oldDoc.is_protected) {
      throw({ forbidden: 'Cannot delete system protected unit of measure' });
    }
    if (oldDoc && oldDoc.type === 'unit_of_measure' && oldDoc.code !== newDoc.code) {
      throw({ forbidden: 'Cannot modify code of a unit of measure' });
    }
    if (oldDoc && oldDoc.type === 'unit_of_measure' && oldDoc.is_protected) {
      if (!newDoc.is_protected) {
        throw({ forbidden: 'Cannot unprotect a system protected unit of measure' });
      }
      if (oldDoc.code !== newDoc.code || oldDoc.dimension !== newDoc.dimension) {
        throw({ forbidden: 'Cannot modify code or dimension of a protected unit of measure' });
      }
    }
    if (newDoc.type === 'item_master' && newDoc.base_unit &&
        !/^[a-z][a-z0-9_]{0,15}$/.test(newDoc.base_unit) &&
        !(oldDoc && oldDoc.type === 'item_master' && oldDoc.base_unit === newDoc.base_unit &&
          isLegacyUnitLabel(newDoc.base_unit))) {
      throw({ forbidden: 'base_unit must match ^[a-z][a-z0-9_]{0,15}$' });
    }
    if (newDoc.type === 'item_master') {
      validateUnitField(newDoc.default_inventory_uom, 'default_inventory_uom');
      validateUnitField(newDoc.default_issue_uom, 'default_issue_uom');
      if (Array.isArray(newDoc.conversions)) {
        for (var conversionIndex = 0; conversionIndex < newDoc.conversions.length; conversionIndex++) {
          validateUnitField(newDoc.conversions[conversionIndex].uom_name, 'conversions.uom_name');
        }
      }
    }
    if (newDoc.type === 'recipe' && Array.isArray(newDoc.ingredients)) {
      for (var ingredientIndex = 0; ingredientIndex < newDoc.ingredients.length; ingredientIndex++) {
        validateUnitField(newDoc.ingredients[ingredientIndex].uom, 'ingredients.uom');
      }
    }
    if (newDoc.type === 'donation_campaign' && Array.isArray(newDoc.needs)) {
      for (var needIndex = 0; needIndex < newDoc.needs.length; needIndex++) {
        validateUnitField(newDoc.needs[needIndex].unit, 'needs.unit');
      }
    }
    return;
  }
  if (newDoc.type === 'unit_of_measure' || (oldDoc && oldDoc.type === 'unit_of_measure')) {
    throw({ forbidden: 'unit_of_measure is central-only' });
  }
  if (oldDoc && oldDoc.shelter_code !== newDoc.shelter_code) {
    throw({ forbidden: 'shelter_code is immutable' });
  }
  if (newDoc.shelter_code) {
    var hasScope = userCtx.roles.indexOf('shelter:' + newDoc.shelter_code) !== -1;
    var isManager = userCtx.roles.indexOf('shelter_manager') !== -1;
    var isWS = userCtx.roles.indexOf('warehouse_staff') !== -1;
    if (hasScope && (isManager || isWS)) {
      if (newDoc.type === 'item_master' && newDoc.base_unit &&
          !/^[a-z][a-z0-9_]{0,15}$/.test(newDoc.base_unit) &&
          !(oldDoc && oldDoc.type === 'item_master' && oldDoc.base_unit === newDoc.base_unit &&
            isLegacyUnitLabel(newDoc.base_unit))) {
        throw({ forbidden: 'base_unit must match ^[a-z][a-z0-9_]{0,15}$' });
      }
      if (newDoc.type === 'item_master') {
        validateUnitField(newDoc.default_inventory_uom, 'default_inventory_uom');
        validateUnitField(newDoc.default_issue_uom, 'default_issue_uom');
        if (Array.isArray(newDoc.conversions)) {
          for (var localConversionIndex = 0; localConversionIndex < newDoc.conversions.length; localConversionIndex++) {
            validateUnitField(newDoc.conversions[localConversionIndex].uom_name, 'conversions.uom_name');
          }
        }
      }
      if (newDoc.type === 'recipe' && Array.isArray(newDoc.ingredients)) {
        for (var localIngredientIndex = 0; localIngredientIndex < newDoc.ingredients.length; localIngredientIndex++) {
          validateUnitField(newDoc.ingredients[localIngredientIndex].uom, 'ingredients.uom');
        }
      }
      if (newDoc.type === 'donation_campaign' && Array.isArray(newDoc.needs)) {
        for (var localNeedIndex = 0; localNeedIndex < newDoc.needs.length; localNeedIndex++) {
          validateUnitField(newDoc.needs[localNeedIndex].unit, 'needs.unit');
        }
      }
      return;
    }
  }
  throw({ forbidden: 'Only System Admins can write to global catalog documents, and only authorized shelter staff can write local documents.' });
}`;

	const existing = await couchReq('GET', '/catalog/_design/access');
	const existingData =
		existing.status === 200
			? (existing.data as { _rev?: string; validate_doc_update?: string } | null)
			: null;

	if (existingData?.validate_doc_update === validateFn) {
		return 'already_current';
	}

	if (dryRun) {
		return existing.status === 404 ? 'created' : 'updated';
	}

	const rev = existingData?._rev;
	const res = await couchReq('PUT', '/catalog/_design/access', {
		_id: '_design/access',
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: validateFn
	});

	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`catalog _design/access failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return rev ? 'updated' : 'created';
}

async function syncUnitsOfMeasure(dryRun: boolean): Promise<{ created: number; existing: number }> {
	let created = 0;
	let existing = 0;
	const putUnit = async (docId: string, payload: Record<string, unknown>): Promise<void> => {
		const result = await couchReq('PUT', `/catalog/${encodeURIComponent(docId)}`, payload);
		if (result.status < 200 || result.status >= 300) {
			const detail = (result.data as { reason?: string; error?: string } | null) ?? {};
			throw new Error(
				`Cannot sync UOM "${docId}" (HTTP ${result.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
	};

	for (const def of FALLBACK_UNIT_DEFINITIONS) {
		const docId = `unit_of_measure:${def.code}`;
		const { status, data } = await couchReq('GET', `/catalog/${encodeURIComponent(docId)}`);

		if (status === 200) {
			existing++;
			if (!dryRun) {
				const current = data as Record<string, unknown>;
				// Ensure protected invariants while preserving user modifications
				await putUnit(docId, {
					...current,
					type: 'unit_of_measure',
					schema_v: 1,
					code: def.code,
					dimension: def.dimension,
					is_protected: true,
					updated_at: new Date().toISOString()
				});
			}
		} else if (status === 404) {
			created++;
			if (!dryRun) {
				const ts = new Date().toISOString();
				await putUnit(docId, {
					_id: docId,
					type: 'unit_of_measure',
					schema_v: 1,
					created_at: ts,
					updated_at: ts,
					created_by: 'system',
					code: def.code,
					label_th: def.label_th,
					...(def.label_th_short ? { label_th_short: def.label_th_short } : {}),
					label_en: def.label_en,
					dimension: def.dimension,
					is_protected: true,
					sort_order: def.sort_order,
					deactivated: false
				});
			}
		} else {
			throw new Error(`Unexpected HTTP ${status} checking ${docId}`);
		}
	}

	return { created, existing };
}

async function syncThailandLocationIndexes(
	dryRun: boolean
): Promise<{ created: number; existing: number }> {
	const indexes = [
		{ name: 'location-by-province_id', fields: ['province_id'] },
		{ name: 'location-by-district_id', fields: ['district_id'] }
	];

	let created = 0;
	let existing = 0;

	for (const def of indexes) {
		if (dryRun) {
			created++;
			continue;
		}
		const res = await couchReq('POST', '/thailand_locations/_index', {
			index: { fields: def.fields },
			name: def.name,
			type: 'json'
		});
		if (res.status >= 400) {
			const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
			throw new Error(
				`Mango index ${def.name} on thailand_locations failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
		const result = (res.data as { result?: string } | null)?.result;
		if (result === 'exists') {
			existing++;
		} else {
			created++;
		}
	}
	return { created, existing };
}

async function syncMasterSopBaseline(
	dryRun: boolean
): Promise<'already_exists' | 'created' | 'upgraded'> {
	const fullDocId = 'sop_profile:master_sphere_baseline';
	const { status, data } = await couchReq('GET', `/catalog/${encodeURIComponent(fullDocId)}`);

	let existingRev: string | undefined;

	if (status === 200) {
		const doc = data as { _rev?: string; schema_v?: number };
		if (doc.schema_v === SOP_MASTER_SCHEMA_VERSION && sopMasterSchema.safeParse(data).success) {
			return 'already_exists';
		}
		existingRev = doc._rev;
	} else if (status !== 404) {
		throw new Error(`Unexpected status ${status} checking ${fullDocId}`);
	}

	if (dryRun) return existingRev ? 'upgraded' : 'created';

	const { profile } = createInitialProfile('sop_profile', 'Sphere Baseline', validRatios, {
		createdBy: 'system'
	});
	profile._id = fullDocId;
	if (existingRev) {
		profile._rev = existingRev;
	}

	const putRes = await couchReq('PUT', `/catalog/${encodeURIComponent(fullDocId)}`, profile);
	if (putRes.status !== 201) {
		const detail = (putRes.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot save baseline SOP profile (${putRes.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return existingRev ? 'upgraded' : 'created';
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
	console.log('🔄 Sync Central CouchDB Databases (registry, catalog, thailand_locations)');
	console.log(`   mode: ${DRY_RUN ? 'DRY-RUN (pass --write --confirm to apply)' : 'WRITE'}`);
	console.log('');

	// 1. Ensure databases
	const CENTRAL_DBS = ['registry', 'catalog', 'thailand_locations'];
	for (const db of CENTRAL_DBS) {
		const res = await ensureDb(db, DRY_RUN);
		console.log(`  ✓ DB: ${db} (${res === 'created' && DRY_RUN ? 'would create' : res})`);
	}

	// 2. Security
	const secRoles = {
		admins: { roles: ['system_admin'] },
		members: {
			roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff']
		}
	};
	const regSec = await syncSecurity('registry', secRoles, DRY_RUN);
	console.log(`  ✓ registry: _security (${regSec})`);

	const catSec = await syncSecurity('catalog', secRoles, DRY_RUN);
	console.log(`  ✓ catalog: _security (${catSec})`);

	// 3. Catalog Access VDU
	const catAccess = await syncCatalogAccessDesign(DRY_RUN);
	console.log(`  ✓ catalog: _design/access (${catAccess})`);

	// 4. Thailand Location Indexes
	const locIndexes = await syncThailandLocationIndexes(DRY_RUN);
	console.log(
		`  ✓ thailand_locations: indexes (${locIndexes.created} created/would create, ${locIndexes.existing} existing)`
	);

	// 5. Baseline SOP profile
	const sopRes = await syncMasterSopBaseline(DRY_RUN);
	console.log(`  ✓ catalog: sop_profile:master_sphere_baseline (${sopRes})`);

	// 6. Units of Measure Master Data
	const uomRes = await syncUnitsOfMeasure(DRY_RUN);
	console.log(
		`  ✓ catalog: units of measure (${uomRes.created} created/would create, ${uomRes.existing} existing)`
	);

	console.log('');
	console.log('✨ Central database synchronization completed successfully');
}

main().catch((e) => {
	console.error('Fatal:', e instanceof Error ? e.message : String(e));
	process.exit(1);
});
