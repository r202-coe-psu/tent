/**
 * Standalone seed for Thailand location reference data (CR-037).
 *
 * Separate from the main `pnpm seed` because this is static central reference
 * data (~8,431 docs) that changes rarely — no need to re-run it every time the
 * mock dataset is reseeded.
 *
 * Usage:  pnpm seed:thailand   (from frontend/)
 * Needs:  CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 *
 * Idempotent: deterministic `_id`s → re-running PUTs the same ids, so existing
 * docs return 409 (skipped) and no duplicates are created.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	buildLocationDocs,
	LOCATION_DB,
	type LocationRow
} from '$lib/features/locations/domain/location';

// ─── env ────────────────────────────────────────────────────────────────────

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
				return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
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
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

async function ensureDb(name: string): Promise<void> {
	const { status } = await couchReq('PUT', `/${name}`);
	if (status !== 201 && status !== 412)
		throw new Error(`Cannot create database "${name}" (HTTP ${status})`);
}

// ─── seed ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const displayUrl = rawCouchUrl.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
	console.log(`\nSeeding Thailand location → ${displayUrl}\n`);

	await ensureDb(LOCATION_DB);

	// Mango indexes the BFF cascade queries rely on (idempotent — 200 on re-create).
	for (const field of ['province_id', 'district_id']) {
		const { status } = await couchReq('POST', `/${LOCATION_DB}/_index`, {
			index: { fields: [field] },
			name: `location-by-${field}`,
			type: 'json'
		});
		if (status !== 200 && status !== 201)
			throw new Error(`Cannot create index on ${field} (HTTP ${status})`);
	}

	const jsonPath = resolve(__dirname, '../static/data/thailand_location_data.json');
	const rows = JSON.parse(readFileSync(jsonPath, 'utf-8')) as LocationRow[];
	const { provinces, districts, subdistricts } = buildLocationDocs(rows);
	const docs = [...provinces, ...districts, ...subdistricts];

	const CHUNK = 2000;
	for (let i = 0; i < docs.length; i += CHUNK) {
		const { status } = await couchReq('POST', `/${LOCATION_DB}/_bulk_docs`, {
			docs: docs.slice(i, i + CHUNK)
		});
		if (status !== 201) throw new Error(`_bulk_docs to "${LOCATION_DB}" failed (HTTP ${status})`);
	}

	console.log(
		`  ✓ ${LOCATION_DB}: thailand-location (${provinces.length} provinces, ${districts.length} districts, ${subdistricts.length} subdistricts)\n`
	);
}

main().catch((err) => {
	console.error('\nThailand location seed failed:', err);
	process.exit(1);
});
