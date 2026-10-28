/**
 * Backfill `closed_at` on legacy closed shelters (CR-183 FR-22).
 *
 *   pnpm migrate:shelter-closed-at                    # dry-run
 *   pnpm migrate:shelter-closed-at --write --confirm
 *
 * Run the write before deploying the worker that enforces closed-shelter
 * retention, otherwise legacy closed shelters have no retention clock.
 * Needs COUCHDB_ADMIN_URL in frontend/.env. Idempotent: shelters that already
 * have `closed_at` are not selected.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	applyClosedAtBackfill,
	planClosedAtBackfill,
	type ClosedAtBackfill
} from '../src/lib/features/shelters/server';

type CouchDoc = Record<string, unknown> & { _id: string };
type Result = 'would_update' | 'updated' | 'failed';
type ReportRow = ClosedAtBackfill & { result: Result; error?: string };

function loadEnv(): Record<string, string> {
	const envPath = resolve(process.cwd(), '.env');
	if (!existsSync(envPath)) return {};
	return Object.fromEntries(
		readFileSync(envPath, 'utf-8')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#') && line.includes('='))
			.map((line) => {
				const separator = line.indexOf('=');
				return [
					line.slice(0, separator).trim(),
					line
						.slice(separator + 1)
						.trim()
						.replace(/^['"]|['"]$/g, '')
				];
			})
	);
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

const env = loadEnv();
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL;
if (!rawCouchUrl) throw new Error('COUCHDB_ADMIN_URL is not set in frontend/.env');
const { baseUrl, authHeader } = parseCouchUrl(rawCouchUrl);
const dryRun = !process.argv.includes('--write');
if (!dryRun && !process.argv.includes('--confirm')) throw new Error('--write requires --confirm');

const REGISTRY_DB = 'registry';

async function couchReq(method: string, path: string, body?: unknown) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authHeader) headers.Authorization = authHeader;
	const response = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: response.status, data: await response.json().catch(() => null) };
}

async function main() {
	const now = new Date().toISOString();
	const runId = `shelter-closed-at-${now.replace(/[-:.TZ]/g, '')}`;
	const list = await couchReq(
		'GET',
		`/${REGISTRY_DB}/_all_docs?include_docs=true&startkey=${encodeURIComponent('"shelter:"')}&endkey=${encodeURIComponent('"shelter:￰"')}`
	);
	if (list.status >= 400) throw new Error(`โหลด registry ไม่สำเร็จ (${list.status})`);
	const docs = ((list.data as { rows?: Array<{ doc?: CouchDoc }> })?.rows ?? [])
		.map((row) => row.doc)
		.filter((doc): doc is CouchDoc => Boolean(doc?._id));

	const report: ReportRow[] = [];
	for (const doc of docs) {
		const plan = planClosedAtBackfill(doc, now);
		if (!plan) continue;
		if (dryRun) {
			report.push({ ...plan, result: 'would_update' });
			continue;
		}
		const res = await couchReq(
			'PUT',
			`/${REGISTRY_DB}/${encodeURIComponent(doc._id)}`,
			applyClosedAtBackfill(doc, plan, now, runId)
		);
		if (res.status < 300) {
			report.push({ ...plan, result: 'updated' });
		} else {
			const reason = (res.data as { reason?: string } | null)?.reason ?? 'unknown';
			report.push({ ...plan, result: 'failed', error: `${res.status}: ${reason}` });
		}
	}

	console.log(
		JSON.stringify(
			{ mode: dryRun ? 'dry-run' : 'write', runId, count: report.length, shelters: report },
			null,
			2
		)
	);
	if (report.some((row) => row.result === 'failed')) process.exitCode = 1;
}

main().catch((error) => {
	console.error('Fatal:', error instanceof Error ? error.message : error);
	process.exit(1);
});
