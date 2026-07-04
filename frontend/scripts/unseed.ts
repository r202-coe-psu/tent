/**
 * Remove mock seed data from the Smart Shelter dev environment.
 *
 * Usage (from frontend/):
 *   pnpm unseed              dry-run — list docs that would be deleted
 *   pnpm unseed --confirm    apply deletions to CouchDB
 *
 * Needs: CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 *
 * Deletes documents that match any of:
 *   - created_by === 'seed'
 *   - known deterministic seed IDs (catalog items, recipes, SOP profile, audit)
 *   - _id prefix evacuee:seed-genname- (dashboard mock batch)
 *
 * Preserves design docs, _security, and non-seed user data.
 * Does not drop databases.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function dbExists(name: string): Promise<boolean> {
	const { status } = await couchReq('GET', `/${name}`);
	return status === 200;
}

type CouchDoc = { _id: string; _rev: string; created_by?: string; type?: string };

async function listAllDocs(db: string): Promise<CouchDoc[]> {
	const docs: CouchDoc[] = [];
	let startkey: string | undefined;

	for (;;) {
		const qs = new URLSearchParams({ include_docs: 'true', limit: '500' });
		if (startkey !== undefined) {
			qs.set('startkey', JSON.stringify(startkey));
			qs.set('skip', '1');
		}
		const { status, data } = await couchReq('GET', `/${db}/_all_docs?${qs}`);
		if (status === 404) return [];
		if (status !== 200) throw new Error(`_all_docs on "${db}" failed (HTTP ${status})`);

		const rows = (data as { rows: { id: string; doc?: CouchDoc }[]; total_rows?: number }).rows;
		if (rows.length === 0) break;

		for (const row of rows) {
			if (row.doc && !row.id.startsWith('_')) docs.push(row.doc);
		}

		const lastId = rows[rows.length - 1].id;
		if (rows.length < 500) break;
		startkey = lastId;
	}

	return docs;
}

async function bulkDelete(db: string, docs: CouchDoc[]): Promise<number> {
	if (docs.length === 0) return 0;
	const payload = docs.map((d) => ({ _id: d._id, _rev: d._rev, _deleted: true }));
	const { status, data } = await couchReq('POST', `/${db}/_bulk_docs`, { docs: payload });
	if (status !== 201) throw new Error(`_bulk_docs delete on "${db}" failed (HTTP ${status})`);
	const results = data as { id: string; ok?: boolean; error?: string; reason?: string }[];
	const errs = results.filter((r) => r.error);
	if (errs.length) console.warn(`  ⚠ delete errors in ${db}:`, errs.slice(0, 5));
	return results.filter((r) => r.ok).length;
}

// ─── seed identity ────────────────────────────────────────────────────────────

/** Deterministic catalog / audit IDs written by scripts/seed.ts */
const DETERMINISTIC_SEED_IDS = new Set([
	'item:rice',
	'item:water',
	'item:paracetamol',
	'item:soap',
	'item:blanket',
	'item:egg',
	'recipe:fried-egg-rice',
	'recipe:congee',
	'sop_profile:master_sphere_baseline',
	'audit:seed_sphere_baseline'
]);

const SEED_DBS = ['registry', 'catalog', 'shelter_sh001', 'shelter_sh002'] as const;

function isSeedDoc(doc: CouchDoc): boolean {
	if (doc.created_by === 'seed') return true;
	if (DETERMINISTIC_SEED_IDS.has(doc._id)) return true;
	if (doc._id.startsWith('evacuee:seed-genname-')) return true;
	if (doc._id.startsWith('audit:seed_')) return true;
	return false;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function unseedDb(db: string, write: boolean): Promise<number> {
	const exists = await dbExists(db);
	if (!exists) {
		console.log(`  · ${db}: database not found, skipping`);
		return 0;
	}

	const all = await listAllDocs(db);
	const toDelete = all.filter(isSeedDoc);

	if (toDelete.length === 0) {
		console.log(`  · ${db}: no seed docs`);
		return 0;
	}

	const byType = new Map<string, number>();
	for (const doc of toDelete) {
		const key = doc.type ?? '(no type)';
		byType.set(key, (byType.get(key) ?? 0) + 1);
	}
	const summary = [...byType.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([t, n]) => `${t}=${n}`)
		.join(', ');

	if (!write) {
		console.log(`  · ${db}: would delete ${toDelete.length} docs (${summary})`);
		return toDelete.length;
	}

	const deleted = await bulkDelete(db, toDelete);
	console.log(`  ✓ ${db}: deleted ${deleted} docs (${summary})`);
	return deleted;
}

async function main() {
	const write = process.argv.includes('--confirm');
	const displayUrl = rawCouchUrl.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');

	console.log(`\nUnseed mock data → ${displayUrl}`);
	console.log(write ? 'Mode: WRITE (--confirm)\n' : 'Mode: DRY-RUN (pass --confirm to apply)\n');

	try {
		let total = 0;
		for (const db of SEED_DBS) {
			total += await unseedDb(db, write);
		}

		if (!write) {
			console.log(`\nDry-run complete: ${total} seed doc(s) would be deleted.`);
			console.log('Re-run with:  pnpm unseed --confirm\n');
		} else {
			console.log(`\nDone. Deleted ${total} seed doc(s).\n`);
		}
	} catch (err) {
		console.error('\nUnseed failed:', err);
		process.exit(1);
	}
}

main();
