/**
 * Migration script: shelter master doc v2 → current (CR-008)
 *
 * Usage:  pnpm migrate:shelter            (dry-run, default)
 *         pnpm migrate:shelter --write    (apply changes to CouchDB)
 *         pnpm migrate:shelter --confirm  (required alongside --write)
 *
 * Needs:  COUCHDB_ADMIN_URL in frontend/.env (no default — security)
 *         Format: http://admin:<password>@localhost:5984
 *
 * Idempotent — safe to re-run. Only updates docs with `schema_v < 3`.
 * The migration logic is shared with $lib/features/shelters/domain/schema.ts
 * via `migrateShelterV2ToCurrent` — this script is a thin runner around it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const rawCouchUrl = env.COUCHDB_ADMIN_URL;

if (!rawCouchUrl) {
	console.error('✗ COUCHDB_ADMIN_URL is not set in frontend/.env');
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

// ─── Reuse the shared migration from $lib/features/shelters/domain/schema.ts ─
//
// We load the schema module via a tsx-friendly approach: just import directly
// with the `.ts` extension. Vitest is set up to run this; the script invokes
// it via `tsx scripts/migrate-shelter.ts` (configured in package.json).

import { migrateShelterV2ToCurrent } from '../src/lib/features/shelters/domain/schema';

// ─── Main ────────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--write');
const CONFIRMED = process.argv.includes('--confirm');
const REGISTRY_DB = 'registry';

if (!DRY_RUN && !CONFIRMED) {
	console.error('✗ --write requires --confirm (a typo could write to production)');
	console.error('  Re-run with: pnpm migrate:shelter --write --confirm');
	process.exit(1);
}

async function main() {
	console.log(`🔄 Shelter master v2 → current migration`);
	console.log(`   COUCH: ${COUCH_URL}`);
	console.log(`   mode: ${DRY_RUN ? 'DRY-RUN (pass --write --confirm to apply)' : 'WRITE'}`);
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

	// We accept any v2 master regardless of its specific shape — the shared
	// migration handles the backfill of all new fields.
	interface DocShape {
		_id: string;
		_rev?: string;
		schema_v?: number;
		code?: string;
		type?: string;
	}
	const rows =
		(listRes.data as { rows?: Array<{ id: string; doc: DocShape }> })?.rows ?? [];
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
		if ((v2.schema_v ?? 0) >= 3) {
			console.log(`  ⊘ ${v2.code} (${row.id}) — already v3, skip`);
			skipped++;
			continue;
		}

		const v3 = migrateShelterV2ToCurrent(v2 as never) as unknown as Record<string, unknown>;

		console.log(`  → ${v2.code} (${row.id}) v${v2.schema_v} → current`);
		console.log(`    capacity backfill: ${v3.capacity}`);
		console.log(`    zones: ${Array.isArray(v3.zones) ? (v3.zones as unknown[]).length : 0}`);

		if (!DRY_RUN) {
			try {
				const putRes = await couchReq(
					'PUT',
					`/${REGISTRY_DB}/${encodeURIComponent(row.id)}`,
					v3
				);
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
		console.log('💡 Re-run with --write --confirm to apply');
	}
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(1);
});
