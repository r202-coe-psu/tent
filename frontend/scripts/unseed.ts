/**
 * Unseed script — delete every CouchDB database except `_users`.
 *
 * Usage:  pnpm unseed              (dry-run — lists databases that would be deleted)
 *         pnpm unseed --confirm    (delete for real)
 *
 * Needs:  CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP = new Set(['_users']);

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
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	return { status: res.status, data };
}

async function listDatabases(): Promise<string[]> {
	const { status, data } = await couchReq('GET', '/_all_dbs');
	if (status !== 200) throw new Error(`Cannot list databases (HTTP ${status})`);
	return data as string[];
}

async function deleteDatabase(name: string): Promise<void> {
	const { status, data } = await couchReq('DELETE', `/${encodeURIComponent(name)}`);
	if (status !== 200 && status !== 202) {
		const detail = (data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot delete database "${name}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
	const confirm = process.argv.includes('--confirm');
	const displayUrl = rawCouchUrl.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');

	const dbs = await listDatabases();
	const toDelete = dbs.filter((db) => !KEEP.has(db));

	console.log(`\nUnseed → ${displayUrl}`);
	console.log(`Keeping: ${[...KEEP].join(', ') || '(none)'}`);

	if (toDelete.length === 0) {
		console.log('\nNothing to delete.\n');
		return;
	}

	console.log(`\nDatabases to delete (${toDelete.length}):`);
	for (const db of toDelete) console.log(`  - ${db}`);

	if (!confirm) {
		console.log('\nDry run — re-run with --confirm to delete.\n');
		return;
	}

	console.log('');
	for (const db of toDelete) {
		await deleteDatabase(db);
		console.log(`  ✓ deleted ${db}`);
	}
	console.log('\nDone.\n');
}

main().catch((err) => {
	console.error('\nUnseed failed:', err);
	process.exit(1);
});
