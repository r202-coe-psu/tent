/**
 * Additive migration for volunteer identity/skill review and application review reasons.
 *
 * Usage from frontend/:
 *   pnpm migrate:volunteer-review              # dry run
 *   pnpm migrate:volunteer-review --write --confirm
 *
 * Set SHELTER_DB to migrate another shelter. The script is idempotent and only
 * writes documents that are missing the new review fields.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	backfillVolunteerReview,
	deriveReviewReasons
} from '../src/lib/features/volunteers/domain/review-migration';

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
if (!rawCouchUrl) {
	console.error('✗ COUCHDB_ADMIN_URL is not set in frontend/.env');
	process.exit(1);
}

const { baseUrl: couchUrl, authHeader } = parseCouchUrl(rawCouchUrl);
const dbName = process.env.SHELTER_DB ?? env.SHELTER_DB ?? 'shelter_sh001';
const dryRun = !process.argv.includes('--write');
const confirmed = process.argv.includes('--confirm');
if (!dryRun && !confirmed) {
	console.error('✗ --write requires --confirm');
	process.exit(1);
}

async function couchReq(method: string, path: string, body?: unknown) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authHeader) headers.Authorization = authHeader;
	const response = await fetch(`${couchUrl}${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	const data = await response.json().catch(() => null);
	return { status: response.status, data };
}

type CouchDoc = Record<string, unknown> & { _id: string; _rev?: string; type?: string };

async function main() {
	console.log(`🔄 Volunteer review migration → ${dbName}`);
	console.log(`   mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}`);

	const response = await couchReq(
		'GET',
		`/${encodeURIComponent(dbName)}/_all_docs?include_docs=true`
	);
	if (response.status >= 400) throw new Error(`โหลด CouchDB ไม่สำเร็จ (${response.status})`);
	const rows = ((response.data as { rows?: Array<{ doc?: CouchDoc }> })?.rows ?? []).filter(
		(row): row is { doc: CouchDoc } => Boolean(row.doc?._id)
	);
	const jobs = new Map(
		rows.filter((row) => row.doc.type === 'job').map((row) => [row.doc._id, row.doc])
	);
	const candidates = rows.filter(
		(row) => row.doc.type === 'volunteer' || row.doc.type === 'job_application'
	);

	let changed = 0;
	let skipped = 0;
	for (const row of candidates) {
		const before = row.doc;
		const next =
			before.type === 'volunteer'
				? backfillVolunteerReview(before)
				: Array.isArray(before.review_reasons)
					? before
					: {
							...before,
							review_reasons: deriveReviewReasons(
								before,
								jobs.get(String(before.job_id)) ?? jobs.get(`job:${String(before.job_id)}`)
							)
						};
		const changedFields = JSON.stringify(next) !== JSON.stringify(before);
		if (!changedFields) {
			skipped++;
			continue;
		}
		changed++;
		console.log(`  → ${before._id}`);
		if (!dryRun) {
			const put = await couchReq(
				'PUT',
				`/${encodeURIComponent(dbName)}/${encodeURIComponent(before._id)}`,
				next
			);
			if (put.status >= 400) throw new Error(`เขียน ${before._id} ไม่สำเร็จ (${put.status})`);
		}
	}

	console.log(`📊 changed: ${changed}, skipped: ${skipped}`);
	if (dryRun && changed > 0) console.log('💡 Re-run with --write --confirm to apply');
}

main().catch((error) => {
	console.error('Fatal:', error instanceof Error ? error.message : error);
	process.exit(1);
});
