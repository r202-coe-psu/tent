/**
 * One-off, re-runnable normalization of the evacuee fields the server-side search matches on
 * (CR-229 Migration, #554), on every shelter DB.
 *
 * Usage (from frontend/):
 *   pnpm normalize:evacuee-search                      # dry-run: counts only, writes nothing (default)
 *   pnpm normalize:evacuee-search --write --confirm    # apply
 *
 * Needs: COUCHDB_ADMIN_URL in the environment or frontend/.env
 *
 * Order per environment (CR-229): `pnpm redeploy:access --write --confirm` first (indexes), then
 * this script — at central before edge.
 *
 * - `phone`, `emergency_contact.phone` → `0XXXXXXXXX` (only when that yields a 10-digit mobile)
 * - `person_id.number` (`national_id`) → digits only (only when that yields 13 digits)
 * - `person_id.number` (other types, never `anonymous`) → upper case, no whitespace
 *
 * Values with no canonical form are left untouched and counted. Nothing else on the doc changes
 * besides `updated_at`; `schema_v` is not bumped. A second run normalizes 0. A write conflict is
 * re-read and retried once; what still conflicts is reported and the script exits non-zero.
 *
 * Runs under plain `tsx`: only the pure `$lib/features/people/server` and
 * `$lib/server/{registry-redeploy,shelter-access-design}` modules are imported.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	emptySearchNormalizeCounts,
	normalizeEvacueeSearchFields,
	planEvacueeSearchNormalize,
	type SearchNormalizeCandidate,
	type SearchNormalizeCounts,
	type SearchNormalizeField
} from '$lib/features/people/server';
import { listShelterMasters } from '$lib/server/registry-redeploy';
import { shelterDbName } from '$lib/server/shelter-access-design';

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

const WRITE = process.argv.includes('--write');
const CONFIRMED = process.argv.includes('--confirm');
const DRY_RUN = !WRITE;

if (WRITE && process.argv.includes('--dry-run')) {
	console.error('✗ --dry-run and --write cannot be combined');
	process.exit(1);
}
if (WRITE && !CONFIRMED) {
	console.error('✗ --write requires --confirm (a typo could write to production)');
	console.error('  Re-run with: pnpm normalize:evacuee-search --write --confirm');
	process.exit(1);
}

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

function failure(res: { status: number; data: unknown }): string {
	const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
	return `${res.status} ${detail.reason ?? detail.error ?? 'unknown'}`;
}

const PAGE_SIZE = 500;
const WRITE_BATCH = 200;

interface EvacueeDoc extends SearchNormalizeCandidate {
	type: 'evacuee';
	_rev?: string;
}

async function scanEvacuees(db: string): Promise<EvacueeDoc[] | null> {
	const evacuees: EvacueeDoc[] = [];
	let startKey: string | null = null;
	for (;;) {
		const query: string =
			`include_docs=true&limit=${PAGE_SIZE + 1}` +
			(startKey === null ? '' : `&startkey=${encodeURIComponent(JSON.stringify(startKey))}`);
		const res = await couchReq('GET', `/${db}/_all_docs?${query}`);
		if (res.status === 404) return null;
		if (res.status >= 400) throw new Error(`could not list ${db} (${failure(res)})`);
		const rows =
			(res.data as { rows?: { id: string; doc?: Record<string, unknown> }[] } | null)?.rows ?? [];
		for (const row of rows.slice(0, PAGE_SIZE)) {
			if (row.doc?.type === 'evacuee') evacuees.push(row.doc as unknown as EvacueeDoc);
		}
		if (rows.length <= PAGE_SIZE) return evacuees;
		startKey = rows[PAGE_SIZE].id;
	}
}

interface WriteOutcome {
	conflicts: string[];
	failed: string[];
}

async function retryConflict(
	db: string,
	id: string,
	now: Date
): Promise<'ok' | 'skipped' | 'conflict'> {
	const fresh = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	if (fresh.status >= 400) throw new Error(`re-read ${id} failed (${failure(fresh)})`);
	const next = normalizeEvacueeSearchFields(fresh.data as EvacueeDoc, now).doc;
	if (next === null) return 'skipped';
	const put = await couchReq('PUT', `/${db}/${encodeURIComponent(id)}`, next);
	if (put.status === 409) return 'conflict';
	if (put.status >= 400) throw new Error(`retry write ${id} failed (${failure(put)})`);
	return 'ok';
}

async function writeUpdates(
	db: string,
	updates: readonly EvacueeDoc[],
	counts: SearchNormalizeCounts,
	now: Date
): Promise<WriteOutcome> {
	const outcome: WriteOutcome = { conflicts: [], failed: [] };
	for (let i = 0; i < updates.length; i += WRITE_BATCH) {
		const batch = updates.slice(i, i + WRITE_BATCH);
		const res = await couchReq('POST', `/${db}/_bulk_docs`, { docs: batch });
		if (res.status >= 400) throw new Error(`_bulk_docs failed in ${db} (${failure(res)})`);
		const results =
			(res.data as { id: string; ok?: boolean; error?: string; reason?: string }[]) ?? [];
		for (const result of results) {
			if (result.ok) continue;
			counts.normalized--;
			if (result.error !== 'conflict') {
				outcome.failed.push(`${result.id}: ${result.error} ${result.reason ?? ''}`.trim());
				continue;
			}
			const retried = await retryConflict(db, result.id, now);
			if (retried === 'ok') counts.normalized++;
			else if (retried === 'skipped') counts.unchanged++;
			else outcome.conflicts.push(result.id);
		}
	}
	return outcome;
}

const FIELDS: readonly SearchNormalizeField[] = [
	'phone',
	'emergency_contact.phone',
	'person_id.number'
];

function printCounts(counts: SearchNormalizeCounts, conflicts: number, failed: number): void {
	console.log(`    scanned:                  ${counts.scanned}`);
	console.log(
		`    ${(DRY_RUN ? 'would normalize:' : 'normalized:').padEnd(26)}${counts.normalized}`
	);
	console.log(`    already canonical:        ${counts.unchanged}`);
	console.log(`    with untouched values:    ${counts.withInvalid}`);
	for (const field of FIELDS) {
		const n = counts.invalidByField[field];
		if (n > 0) console.log(`      ${`${field}:`.padEnd(24)}${n}`);
	}
	console.log(`    conflicts:                ${conflicts}`);
	if (failed > 0) console.log(`    failed:                   ${failed}`);
}

function addCounts(total: SearchNormalizeCounts, counts: SearchNormalizeCounts): void {
	total.scanned += counts.scanned;
	total.normalized += counts.normalized;
	total.unchanged += counts.unchanged;
	total.withInvalid += counts.withInvalid;
	for (const field of FIELDS) total.invalidByField[field] += counts.invalidByField[field];
}

async function main(): Promise<void> {
	console.log('🔄 Normalize evacuee search fields (CR-229)');
	console.log(`   COUCH: ${COUCH_URL}`);
	console.log(`   mode: ${DRY_RUN ? 'DRY-RUN (pass --write --confirm to apply)' : 'WRITE'}`);
	console.log('');

	const masters = await listShelterMasters(couchReq);
	if (masters.length === 0) {
		console.log('⚠️  No shelter masters in registry, nothing to do');
		return;
	}
	console.log(`📋 Found ${masters.length} shelter(s)`);
	console.log('');

	const total = emptySearchNormalizeCounts();
	let totalConflicts = 0;
	let totalFailed = 0;

	for (const master of masters) {
		const db = shelterDbName(master.code);
		console.log(`  → ${master.code} (${db})`);
		try {
			const evacuees = await scanEvacuees(db);
			if (evacuees === null) {
				console.log('    ⚠️  database not found, skipped');
				continue;
			}
			const now = new Date();
			const { updates, counts } = planEvacueeSearchNormalize(evacuees, now);
			const outcome: WriteOutcome = DRY_RUN
				? { conflicts: [], failed: [] }
				: await writeUpdates(db, updates, counts, now);
			printCounts(counts, outcome.conflicts.length, outcome.failed.length);
			for (const id of outcome.conflicts) console.error(`    ✗ conflict after retry: ${id}`);
			for (const line of outcome.failed) console.error(`    ✗ write failed: ${line}`);
			addCounts(total, counts);
			totalConflicts += outcome.conflicts.length;
			totalFailed += outcome.failed.length;
		} catch (error) {
			totalFailed++;
			console.error(`    ✗ ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	console.log('');
	console.log('📊 Total');
	printCounts(total, totalConflicts, totalFailed);
	if (totalConflicts > 0 || totalFailed > 0) process.exit(1);
}

main().catch((e) => {
	console.error('✗ Unexpected error:', e);
	process.exit(1);
});
