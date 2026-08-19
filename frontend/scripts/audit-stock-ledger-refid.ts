/**
 * Audit `stock_ledger.ref_id` against the CR-055 R2 table (`reason` → required
 * `ref_id` prefix).
 *
 * The invariant is enforced on the way IN by `stockLedgerInputSchema` (CR-055
 * R1) and ledger rows are append-only, so a row written before the guard
 * existed can never be corrected in place. This script is how those rows get
 * found: CR-055 Q-4 requires its output attached to the PR before the guard
 * ships, and the DoD expects 0 violations (or a list the owner has signed off
 * on).
 *
 * Usage (from frontend/):
 *   pnpm audit:ledger-refid                    # every shelter_* database
 *   pnpm audit:ledger-refid --db shelter_sh001 # one database
 *
 * Exit code 1 when any violating row is found, 0 when clean.
 * READ-ONLY — this script never writes to CouchDB.
 *
 * Needs: COUCHDB_ADMIN_URL in frontend/.env
 *   Format: http://admin:<password>@<host>:<port>
 *
 * Runs under plain `tsx` (not the SvelteKit runtime), so it must NOT import the
 * `$lib/features/operations` barrel — that re-exports `.svelte` components and
 * TanStack Query hooks, which pull in `$env`/`@sveltejs/kit`. The domain module
 * is pure (zod + `$lib/db/model`), and `scripts/**` is exempt from the
 * feature-barrel lint rule for exactly this case. Importing the real table
 * instead of restating it is the whole point: an audit that keeps its own copy
 * of the rule drifts from the guard it is supposed to be checking.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	REF_PREFIX_BY_REASON,
	type LedgerReason
} from '$lib/features/operations/domain/operations';

/** `_id` prefix of the docs under audit — also the `_all_docs` range key. */
const LEDGER_ID_PREFIX = 'stock_ledger:';

/** Shelter databases are `shelter_{code}` (see `shelterDbName`). */
const SHELTER_DB_PREFIX = 'shelter_';

/** Rows fetched per `_all_docs` request. */
const PAGE_SIZE = 2000;

/** Violating `_id`s printed per (database, reason) group. */
const SAMPLE_LIMIT = 5;

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

// ─── CouchDB helpers (tsx-safe; mirror unseed/redeploy-access) ────────────────

async function couchGet(path: string): Promise<{ status: number; data: unknown }> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (COUCH_AUTH) headers['Authorization'] = COUCH_AUTH;
	const res = await fetch(`${COUCH_URL}${path}`, { method: 'GET', headers });
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	return { status: res.status, data };
}

function couchError(what: string, status: number, data: unknown): Error {
	const detail = (data as { reason?: string; error?: string } | null) ?? {};
	return new Error(`${what} (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`);
}

async function listShelterDbs(): Promise<string[]> {
	const { status, data } = await couchGet('/_all_dbs');
	if (status !== 200) throw couchError('Cannot list databases', status, data);
	return (data as string[]).filter((db) => db.startsWith(SHELTER_DB_PREFIX)).sort();
}

interface LedgerDoc {
	_id: string;
	reason?: string;
	ref_id?: string | null;
}

interface AllDocsRow {
	id: string;
	doc?: LedgerDoc;
}

/**
 * Streams every `stock_ledger:*` doc in `db`.
 *
 * Ranged over `_all_docs` rather than `_find`: `_id` already carries the type
 * prefix, so the primary index answers this without a Mango index existing on
 * the database (an audit has to run against databases nobody prepared).
 */
async function* ledgerDocs(db: string): AsyncGenerator<LedgerDoc> {
	let startkey = LEDGER_ID_PREFIX;
	for (;;) {
		const qs = new URLSearchParams({
			include_docs: 'true',
			startkey: JSON.stringify(startkey),
			// ￰ sorts above any realistic ULID, closing the prefix range
			endkey: JSON.stringify(`${LEDGER_ID_PREFIX}￰`),
			// one extra row is the pagination bookmark, not a result
			limit: String(PAGE_SIZE + 1)
		});
		const { status, data } = await couchGet(`/${encodeURIComponent(db)}/_all_docs?${qs}`);
		if (status !== 200) throw couchError(`Cannot read ${db}`, status, data);

		const rows = (data as { rows?: AllDocsRow[] }).rows ?? [];
		for (const row of rows.slice(0, PAGE_SIZE)) {
			if (row.doc) yield row.doc;
		}
		if (rows.length <= PAGE_SIZE) return;
		// startkey is inclusive — the bookmark row is refetched, never yielded twice
		startkey = rows[PAGE_SIZE].id;
	}
}

// ─── the rule under audit ─────────────────────────────────────────────────────

/** `undefined` = `reason` is not a value the R2 table knows about at all. */
function expectedPrefix(reason: string | undefined): string | null | undefined {
	if (reason === undefined) return undefined;
	if (!Object.prototype.hasOwnProperty.call(REF_PREFIX_BY_REASON, reason)) return undefined;
	return REF_PREFIX_BY_REASON[reason as LedgerReason];
}

/** Returns why the row violates the R2 table, or `null` when it conforms. */
function violationOf(doc: LedgerDoc): string | null {
	const expected = expectedPrefix(doc.reason);
	const found = JSON.stringify(doc.ref_id ?? null);

	if (expected === undefined) {
		return `reason ${JSON.stringify(doc.reason ?? null)} is not in the R2 table`;
	}
	if (expected === null) {
		// a row written before `ref_id` was always stamped reads as absent, not wrong
		return doc.ref_id === null || doc.ref_id === undefined
			? null
			: `expected ref_id null, found ${found}`;
	}
	return typeof doc.ref_id === 'string' && doc.ref_id.startsWith(expected)
		? null
		: `expected ref_id starting with '${expected}', found ${found}`;
}

// ─── report ───────────────────────────────────────────────────────────────────

interface ReasonGroup {
	count: number;
	detail: string;
	samples: string[];
}

interface DbReport {
	db: string;
	scanned: number;
	violations: number;
	byReason: Map<string, ReasonGroup>;
}

async function auditDb(db: string): Promise<DbReport> {
	const report: DbReport = { db, scanned: 0, violations: 0, byReason: new Map() };

	for await (const doc of ledgerDocs(db)) {
		report.scanned += 1;
		const detail = violationOf(doc);
		if (detail === null) continue;

		report.violations += 1;
		const key = doc.reason ?? '(missing reason)';
		const group = report.byReason.get(key) ?? { count: 0, detail, samples: [] };
		group.count += 1;
		if (group.samples.length < SAMPLE_LIMIT) group.samples.push(doc._id);
		report.byReason.set(key, group);
	}

	return report;
}

function printReport(report: DbReport): void {
	const { db, scanned, violations } = report;
	if (violations === 0) {
		console.log(`✓ ${db} — ${scanned} row(s) scanned, clean`);
		return;
	}

	console.log(`✗ ${db} — ${scanned} row(s) scanned, ${violations} violation(s)`);
	for (const [reason, group] of [...report.byReason].sort((a, b) => b[1].count - a[1].count)) {
		console.log(`    reason '${reason}' — ${group.count} row(s): ${group.detail}`);
		for (const id of group.samples) console.log(`      ${id}`);
		if (group.count > group.samples.length) {
			console.log(`      … and ${group.count - group.samples.length} more`);
		}
	}
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
	const dbFlag = process.argv.indexOf('--db');
	const only = dbFlag === -1 ? null : process.argv[dbFlag + 1];

	if (dbFlag !== -1 && !only) {
		console.error('✗ --db needs a database name, e.g. --db shelter_sh001');
		process.exit(1);
	}

	console.log('🔍 stock_ledger ref_id audit — CR-055 R2 (reason → ref_id prefix)');
	console.log(`   host:  ${rawCouchUrl!.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@')}`);

	const dbs = only ? [only] : await listShelterDbs();
	if (dbs.length === 0) {
		console.log('\n⚠️  No shelter_* databases found — nothing to audit.\n');
		return;
	}
	console.log(`   scope: ${dbs.length} database(s)\n`);

	const reports: DbReport[] = [];
	for (const db of dbs) {
		const report = await auditDb(db);
		reports.push(report);
		printReport(report);
	}

	const scanned = reports.reduce((n, r) => n + r.scanned, 0);
	const violations = reports.reduce((n, r) => n + r.violations, 0);
	const dirtyDbs = reports.filter((r) => r.violations > 0).length;

	console.log(`\n${'─'.repeat(64)}`);
	console.log(`Scanned ${scanned} stock_ledger row(s) across ${dbs.length} database(s).`);

	if (violations === 0) {
		console.log('✓ No violations — every row matches the R2 table.\n');
		return;
	}

	console.log(`✗ ${violations} violation(s) in ${dirtyDbs} database(s).`);
	console.log('  Ledger rows are append-only: these cannot be edited in place.');
	console.log('  Correct a balance with an `adjust` entry instead (T-11), or have');
	console.log('  the owner sign off on the list before merging (CR-055 Q-4).\n');
	process.exitCode = 1;
}

main().catch((err) => {
	console.error('\nAudit failed:', err);
	process.exit(1);
});
