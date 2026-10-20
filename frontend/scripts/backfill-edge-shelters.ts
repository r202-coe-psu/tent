/**
 * Backfill `_users.edge_shelters` (CR-171 FR-10).
 *
 * `edge_shelters` = every shelter code a user has ever held `shelter:{code}` for. It routes the
 * filtered `_users` replication to edge servers. Docs written before CR-171 lack it; this fills
 * `mergeEdgeShelters(doc.edge_shelters, doc.roles)` on every `_users` doc (skips `_design/*`).
 *
 * Usage (from frontend/):
 *   pnpm backfill:edge-shelters            # dry-run: report only (default)
 *   pnpm backfill:edge-shelters --write    # PUT the changed docs
 *
 * Idempotent: a second `--write` run reports 0 docs to change. Only changed docs are written.
 * Soft-deleted docs are included (their history must still route to edge).
 * Exit code 1 when any write fails.
 *
 * Needs: COUCHDB_ADMIN_URL in frontend/.env (http://admin:<password>@<host>:<port>)
 *
 * Runs under plain `tsx`: imports only the pure role kernel (`$lib/auth/roles`), never a feature
 * barrel (see audit-stock-ledger-refid.ts for why).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeEdgeShelters } from '$lib/auth/roles';

const WRITE = process.argv.includes('--write');

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
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL;

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

async function couch(
	method: 'GET' | 'PUT',
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (COUCH_AUTH) headers['Authorization'] = COUCH_AUTH;
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	const res = await fetch(`${COUCH_URL}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

interface UserDoc {
	_id: string;
	roles?: string[];
	edge_shelters?: string[];
	[key: string]: unknown;
}

function sameList(a: readonly unknown[] | undefined, b: readonly string[]): boolean {
	return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main(): Promise<void> {
	const list = await couch('GET', '/_users/_all_docs?include_docs=true');
	if (list.status !== 200) {
		throw new Error(`Cannot read _users (HTTP ${list.status})`);
	}
	const rows = (list.data as { rows?: { id: string; doc?: UserDoc }[] }).rows ?? [];

	let scanned = 0;
	let unchanged = 0;
	let toChange = 0;
	let written = 0;
	let failed = 0;

	for (const row of rows) {
		if (row.id.startsWith('_design/') || !row.doc) continue;
		scanned += 1;
		const doc = row.doc;
		const next = mergeEdgeShelters(doc.edge_shelters, doc.roles ?? []);
		if (sameList(doc.edge_shelters, next)) {
			unchanged += 1;
			continue;
		}
		toChange += 1;
		console.log(`  ${WRITE ? '→' : '·'} ${doc._id}: ${JSON.stringify(next)}`);
		if (!WRITE) continue;

		const res = await couch('PUT', `/_users/${encodeURIComponent(doc._id)}`, {
			...doc,
			edge_shelters: next
		});
		if (res.status === 201 || res.status === 200) {
			written += 1;
		} else {
			failed += 1;
			console.error(`  ✗ ${doc._id}: PUT failed (HTTP ${res.status})`);
		}
	}

	console.log(
		`\n${WRITE ? 'WRITE' : 'DRY-RUN'} — scanned ${scanned}, already correct ${unchanged}, ` +
			`${WRITE ? `written ${written}, failed ${failed}` : `would change ${toChange} (re-run with --write)`}`
	);
	if (failed > 0) process.exit(1);
}

main().catch((e) => {
	console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
	process.exit(1);
});
