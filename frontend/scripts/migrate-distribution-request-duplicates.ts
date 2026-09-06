/**
 * Repair legacy distribution_request documents created before e148112.
 *
 * Usage (from frontend/):
 *   pnpm migrate:distribution-request-duplicates --db shelter_sh001
 *   pnpm migrate:distribution-request-duplicates --all-shelters
 *   pnpm migrate:distribution-request-duplicates --db shelter_sh001 --apply --confirm
 *
 * DRY-RUN is the default. `--apply --confirm` is required to write. The runner
 * never selects every database implicitly: choose exactly one `--db` or pass
 * `--all-shelters` deliberately.
 *
 * Only compatible duplicate item_id rows are coalesced. A conflicting unit or
 * distribution type is a collision and is never changed automatically.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	analyzeLegacyDuplicateDistributionRequest,
	type LegacyDuplicateRequestMigration
} from '$lib/features/distribution/domain/legacy-request-duplicate-migration';

const REQUEST_ID_PREFIX = 'distribution_request:';
const SHELTER_DB_PREFIX = 'shelter_';
const PAGE_SIZE = 250;
const MAX_CONFLICT_RETRIES = 3;

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

function loadEnv(): Record<string, string> {
	if (!existsSync(envPath)) return {};
	return Object.fromEntries(
		readFileSync(envPath, 'utf-8')
			.split('\n')
			.filter((line) => line.trim() && !line.startsWith('#') && line.includes('='))
			.map((line) => {
				const eq = line.indexOf('=');
				return [
					line.slice(0, eq).trim(),
					line
						.slice(eq + 1)
						.trim()
						.replace(/^['"]|['"]$/g, '')
				];
			})
	);
}

const env = loadEnv();
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL;

if (!rawCouchUrl) {
	console.error('✗ COUCHDB_ADMIN_URL is not set in frontend/.env or the environment');
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

interface CouchResponse {
	status: number;
	data: unknown;
}

async function couchRequest(method: string, path: string, body?: unknown): Promise<CouchResponse> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	if (COUCH_AUTH) headers.Authorization = COUCH_AUTH;
	const response = await fetch(`${COUCH_URL}${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return {
		status: response.status,
		data: response.status === 204 ? null : await response.json().catch(() => null)
	};
}

function couchError(action: string, response: CouchResponse): Error {
	const detail = (response.data as { error?: string; reason?: string } | null) ?? {};
	return new Error(
		`${action} failed (HTTP ${response.status}): ${detail.reason ?? detail.error ?? 'unknown error'}`
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireTarget(args: string[]): { dbs: string[]; apply: boolean } {
	const dbFlag = args.indexOf('--db');
	const db = dbFlag === -1 ? undefined : args[dbFlag + 1];
	const allShelters = args.includes('--all-shelters');
	const apply = args.includes('--apply');

	if (dbFlag !== -1 && (!db || db.startsWith('--'))) {
		throw new Error('--db requires a shelter database name, for example --db shelter_sh001');
	}
	if (db && !db.startsWith(SHELTER_DB_PREFIX)) {
		throw new Error('--db must name a shelter_* database');
	}
	if (Boolean(db) === allShelters) {
		throw new Error('Choose exactly one target: --db <shelter_db> or --all-shelters');
	}
	if (apply && !args.includes('--confirm')) {
		throw new Error('--apply requires --confirm; dry-run is the default');
	}
	return { dbs: db ? [db] : [], apply };
}

async function listShelterDbs(): Promise<string[]> {
	const response = await couchRequest('GET', '/_all_dbs');
	if (response.status !== 200) throw couchError('Listing CouchDB databases', response);
	if (!Array.isArray(response.data))
		throw new Error('Listing CouchDB databases returned an invalid response');
	return response.data
		.filter((db): db is string => typeof db === 'string' && db.startsWith(SHELTER_DB_PREFIX))
		.sort();
}

async function* distributionRequestDocs(db: string): AsyncGenerator<Record<string, unknown>> {
	let startKey = REQUEST_ID_PREFIX;
	let skip = 0;
	for (;;) {
		const query = new URLSearchParams({
			include_docs: 'true',
			startkey: JSON.stringify(startKey),
			endkey: JSON.stringify(`${REQUEST_ID_PREFIX}\ufff0`),
			limit: String(PAGE_SIZE),
			...(skip === 0 ? {} : { skip: String(skip) })
		});
		const response = await couchRequest(
			'GET',
			`/${encodeURIComponent(db)}/_all_docs?${query.toString()}`
		);
		if (response.status !== 200) throw couchError(`Scanning ${db}`, response);
		const rows =
			isRecord(response.data) && Array.isArray(response.data.rows) ? response.data.rows : null;
		if (!rows) throw new Error(`Scanning ${db} returned an invalid _all_docs response`);
		for (const row of rows) {
			if (isRecord(row) && isRecord(row.doc)) yield row.doc;
		}
		if (rows.length < PAGE_SIZE) return;
		const last = rows.at(-1);
		if (!isRecord(last) || typeof last.id !== 'string') {
			throw new Error(`Scanning ${db} returned a page without a final document ID`);
		}
		startKey = last.id;
		skip = 1;
	}
}

interface DatabaseReport {
	db: string;
	scannedDocs: number;
	affectedDocs: number;
	updatesRequired: number;
	collisions: Extract<LegacyDuplicateRequestMigration, { kind: 'collision' }>[];
	invalidDocs: Extract<LegacyDuplicateRequestMigration, { kind: 'invalid' }>[];
	unchangedDocs: number;
	plannedUpdates: Extract<LegacyDuplicateRequestMigration, { kind: 'update' }>[];
}

async function scanDatabase(db: string): Promise<DatabaseReport> {
	const report: DatabaseReport = {
		db,
		scannedDocs: 0,
		affectedDocs: 0,
		updatesRequired: 0,
		collisions: [],
		invalidDocs: [],
		unchangedDocs: 0,
		plannedUpdates: []
	};

	for await (const doc of distributionRequestDocs(db)) {
		report.scannedDocs += 1;
		const analysis = analyzeLegacyDuplicateDistributionRequest(doc);
		switch (analysis.kind) {
			case 'clean':
				report.unchangedDocs += 1;
				break;
			case 'update':
				report.affectedDocs += 1;
				report.updatesRequired += 1;
				report.plannedUpdates.push(analysis);
				break;
			case 'collision':
				report.affectedDocs += 1;
				report.collisions.push(analysis);
				break;
			case 'invalid':
				report.invalidDocs.push(analysis);
				break;
		}
	}
	return report;
}

function itemSummary(doc: Record<string, unknown>, itemId: string): string {
	const items = Array.isArray(doc.items) ? doc.items : [];
	const rows = items.filter((item) => isRecord(item) && item.item_id === itemId) as Record<
		string,
		unknown
	>[];
	return rows
		.map(
			(item) =>
				`${String(item.requested_qty)} requested / ${String(item.target_qty_snapshot)} target`
		)
		.join(', ');
}

function printReport(report: DatabaseReport): void {
	console.log(`Database: ${report.db}`);
	console.log(`  scanned_docs: ${report.scannedDocs}`);
	console.log(`  affected_docs: ${report.affectedDocs}`);
	console.log(
		`  duplicate_groups: ${report.plannedUpdates.reduce((n, plan) => n + plan.duplicateGroups.length, 0)}`
	);
	console.log(`  updates_required: ${report.updatesRequired}`);
	console.log(`  collisions: ${report.collisions.length}`);
	console.log(`  invalid_docs: ${report.invalidDocs.length}`);
	console.log(`  unchanged_docs: ${report.unchangedDocs}`);

	for (const plan of report.plannedUpdates) {
		console.log(`  DOC: ${plan.docId}`);
		console.log(`    REV: ${plan.originalRev}`);
		for (const group of plan.duplicateGroups) {
			console.log(
				`    BEFORE ${group.itemId}: ${group.rowCount} rows (${group.requestedQtys.join(' + ')} requested; ${group.targetQtys.join(' + ')} target)`
			);
			console.log(`    AFTER  ${group.itemId}: ${itemSummary(plan.doc, group.itemId)}`);
		}
		console.log(
			'    REASON: compatible legacy item_id rows are coalesced with Decimal-safe requested totals; the shared NFI target snapshot is retained'
		);
	}
	for (const collision of report.collisions) {
		console.log(`  COLLISION: ${collision.docId} — ${collision.reason}`);
	}
	for (const invalid of report.invalidDocs) {
		console.log(`  INVALID: ${invalid.docId} — ${invalid.reason}`);
	}
	console.log('');
}

async function getRequestDoc(db: string, id: string): Promise<Record<string, unknown> | null> {
	const response = await couchRequest(
		'GET',
		`/${encodeURIComponent(db)}/${encodeURIComponent(id)}`
	);
	if (response.status === 404) return null;
	if (response.status !== 200) throw couchError(`Reading ${db}/${id}`, response);
	if (!isRecord(response.data))
		throw new Error(`Reading ${db}/${id} returned a malformed document`);
	return response.data;
}

type ApplyOutcome = 'updated' | 'already_clean' | 'blocked';

async function applyPlan(
	db: string,
	planned: Extract<LegacyDuplicateRequestMigration, { kind: 'update' }>
): Promise<ApplyOutcome> {
	for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
		const latest = await getRequestDoc(db, planned.docId);
		if (!latest) return 'blocked';
		const analysis = analyzeLegacyDuplicateDistributionRequest(latest);
		if (analysis.kind === 'clean') return 'already_clean';
		if (analysis.kind !== 'update') return 'blocked';

		const put = await couchRequest(
			'PUT',
			`/${encodeURIComponent(db)}/${encodeURIComponent(analysis.docId)}`,
			analysis.doc
		);
		if (put.status === 409 && attempt < MAX_CONFLICT_RETRIES) continue;
		if (put.status !== 200 && put.status !== 201)
			throw couchError(`Updating ${db}/${analysis.docId}`, put);

		const persisted = await getRequestDoc(db, analysis.docId);
		if (!persisted)
			throw new Error(`Updated ${db}/${analysis.docId} disappeared before verification`);
		const verified = analyzeLegacyDuplicateDistributionRequest(persisted);
		if (verified.kind !== 'clean') {
			throw new Error(
				`Updated ${db}/${analysis.docId} did not verify as canonical (${verified.kind})`
			);
		}
		return 'updated';
	}
	throw new Error(`Conflict retry limit exceeded for ${db}/${planned.docId}`);
}

async function main(): Promise<void> {
	const target = requireTarget(process.argv.slice(2));
	const dbs = target.dbs.length > 0 ? target.dbs : await listShelterDbs();
	console.log('Legacy distribution_request duplicate migration');
	console.log(`mode: ${target.apply ? 'APPLY' : 'DRY-RUN (pass --apply --confirm to write)'}`);
	console.log(`scope: ${dbs.length} database(s)`);
	console.log('');

	const reports: DatabaseReport[] = [];
	for (const db of dbs) {
		const report = await scanDatabase(db);
		reports.push(report);
		printReport(report);
	}

	console.log('| Database | Scanned | Affected | Updates Required | Collisions | Invalid |');
	console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
	for (const report of reports) {
		console.log(
			`| ${report.db} | ${report.scannedDocs} | ${report.affectedDocs} | ${report.updatesRequired} | ${report.collisions.length} | ${report.invalidDocs.length} |`
		);
	}

	if (!target.apply) return;

	let updated = 0;
	let alreadyClean = 0;
	let blocked = 0;
	for (const report of reports) {
		for (const plan of report.plannedUpdates) {
			const outcome = await applyPlan(report.db, plan);
			if (outcome === 'updated') updated += 1;
			else if (outcome === 'already_clean') alreadyClean += 1;
			else blocked += 1;
		}
	}
	console.log(
		`\nApply summary: updated=${updated}, already_clean=${alreadyClean}, blocked=${blocked}`
	);
	if (blocked > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error('\nMigration failed:', error);
	process.exit(1);
});
