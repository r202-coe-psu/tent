/**
 * One-off, re-runnable backfill of `evacuee.consent` on every shelter DB
 * (docs/features/pdpa-consent-block-spec.md §7, FR-50 to FR-52).
 *
 * Usage (from frontend/):
 *   pnpm backfill:evacuee-consent --dry-run            # counts only, writes nothing (default)
 *   pnpm backfill:evacuee-consent --write --confirm    # apply
 *
 * Needs: COUCHDB_ADMIN_URL in the environment or frontend/.env
 *
 * Every evacuee without `consent` and not `anonymized` gets the `backfill` consent (health from
 * the presence of a `medical` doc). `privacy` and `medical` are never touched, nothing is deleted.
 * Skips evacuees that already have `consent`, so a second run backfills 0. A write conflict is
 * re-read and retried once; what still conflicts is reported and the script exits non-zero.
 *
 * Runs under plain `tsx`: only the pure `$lib/features/consent/server` and
 * `$lib/server/{registry-redeploy,shelter-access-design}` modules are imported.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	backfillEvacueeDoc,
	emptyBackfillCounts,
	planConsentBackfill,
	type BackfillCandidate,
	type BackfillCounts
} from '$lib/features/consent/server';
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
	console.error('  Re-run with: pnpm backfill:evacuee-consent --write --confirm');
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

interface EvacueeDoc extends BackfillCandidate {
	type: 'evacuee';
	_rev?: string;
}

interface ScannedShelter {
	evacuees: EvacueeDoc[];
	medicalEvacueeIds: Set<string>;
}

async function scanShelter(db: string): Promise<ScannedShelter | null> {
	const evacuees: EvacueeDoc[] = [];
	const medicalEvacueeIds = new Set<string>();
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
		const page = rows.slice(0, PAGE_SIZE);
		for (const row of page) {
			const doc = row.doc;
			if (!doc || row.id.startsWith('_design/')) continue;
			if (doc.type === 'evacuee') evacuees.push(doc as unknown as EvacueeDoc);
			else if (doc.type === 'medical' && typeof doc.evacuee_id === 'string') {
				medicalEvacueeIds.add(doc.evacuee_id);
			}
		}
		if (rows.length <= PAGE_SIZE) return { evacuees, medicalEvacueeIds };
		startKey = rows[PAGE_SIZE].id;
	}
}

async function hasMedicalDoc(db: string, evacueeId: string): Promise<boolean> {
	const res = await couchReq('POST', `/${db}/_find`, {
		selector: { type: 'medical', evacuee_id: evacueeId },
		fields: ['_id'],
		limit: 1
	});
	if (res.status >= 400) throw new Error(`medical lookup failed in ${db} (${failure(res)})`);
	return ((res.data as { docs?: unknown[] } | null)?.docs ?? []).length > 0;
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
	const doc = fresh.data as EvacueeDoc;
	const next = backfillEvacueeDoc(doc, await hasMedicalDoc(db, doc._id), now);
	if (next === null) return 'skipped';
	const put = await couchReq('PUT', `/${db}/${encodeURIComponent(id)}`, next);
	if (put.status === 409) return 'conflict';
	if (put.status >= 400) throw new Error(`retry write ${id} failed (${failure(put)})`);
	return 'ok';
}

async function writeUpdates(
	db: string,
	updates: readonly EvacueeDoc[],
	counts: BackfillCounts,
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
			counts.backfilled--;
			if (result.error !== 'conflict') {
				outcome.failed.push(`${result.id}: ${result.error} ${result.reason ?? ''}`.trim());
				continue;
			}
			const retried = await retryConflict(db, result.id, now);
			if (retried === 'ok') counts.backfilled++;
			else if (retried === 'skipped') counts.skippedHasConsent++;
			else outcome.conflicts.push(result.id);
		}
	}
	return outcome;
}

function printCounts(counts: BackfillCounts, conflicts: number, failed: number): void {
	console.log(`    scanned:                  ${counts.scanned}`);
	console.log(
		`    ${DRY_RUN ? 'would backfill' : 'backfilled'}:${DRY_RUN ? '           ' : '               '}${counts.backfilled}`
	);
	console.log(`    skipped (has consent):    ${counts.skippedHasConsent}`);
	console.log(`    skipped (anonymized):     ${counts.skippedAnonymized}`);
	console.log(`    conflicts:                ${conflicts}`);
	if (failed > 0) console.log(`    failed:                   ${failed}`);
}

async function main(): Promise<void> {
	console.log('🔄 Backfill evacuee.consent (FR-50)');
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

	const total = emptyBackfillCounts();
	let totalConflicts = 0;
	let totalFailed = 0;

	for (const master of masters) {
		const db = shelterDbName(master.code);
		console.log(`  → ${master.code} (${db})`);
		try {
			const scanned = await scanShelter(db);
			if (scanned === null) {
				console.log('    ⚠️  database not found, skipped');
				continue;
			}
			const now = new Date();
			const { updates, counts } = planConsentBackfill(
				scanned.evacuees,
				scanned.medicalEvacueeIds,
				now
			);
			const outcome: WriteOutcome = DRY_RUN
				? { conflicts: [], failed: [] }
				: await writeUpdates(db, updates, counts, now);
			printCounts(counts, outcome.conflicts.length, outcome.failed.length);
			for (const id of outcome.conflicts) console.error(`    ✗ conflict after retry: ${id}`);
			for (const line of outcome.failed) console.error(`    ✗ write failed: ${line}`);
			total.scanned += counts.scanned;
			total.backfilled += counts.backfilled;
			total.skippedHasConsent += counts.skippedHasConsent;
			total.skippedAnonymized += counts.skippedAnonymized;
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
