/**
 * One-off, re-runnable backfill: check out / cancel everyone still on a stay in a shelter that is
 * already closed (CR-219 FR-28..FR-31, D-8; GitHub #986).
 *
 * Usage (from frontend/):
 *   pnpm migrate:closed-shelter-checkout                          # dry-run (default): counts only
 *   pnpm migrate:closed-shelter-checkout --dry-run                # same, explicit
 *   pnpm migrate:closed-shelter-checkout --shelter SH001          # limit to one closed shelter
 *   pnpm migrate:closed-shelter-checkout --write --confirm        # apply
 *   pnpm migrate:closed-shelter-checkout --shelter SH001 --write --confirm
 *
 * Needs: COUCHDB_ADMIN_URL in the environment or frontend/.env
 *
 * Walks every registry shelter whose operation_status resolves to `closed`. `--dry-run` counts
 * synchronously and writes nothing (CR-243 FR-32). `--write --confirm` does NOT process anyone
 * itself: it creates one `shelter_close_job` with `mode = backfill` per shelter (skipping a
 * shelter that already has an active job) in `central_ops`, prints each `job_id` and returns
 * without waiting (CR-243 FR-31). The `shelter-close-worker` then checks people out
 * (reason `shelter_closed`), cancels `pre_registered`, re-derives households, and writes one
 * summary audit per shelter (CR-219 FR-30a) with `context = { backfill, shelter_closed_at,
 * checked_out, cancelled, failed, households_repaired }` authored by BACKFILL_CREATED_BY.
 * The registry is NEVER written: the shelter stays `closed` and `closed_at` is untouched
 * (CR-183 retention clock). The worker must be running; follow a job with
 * GET /api/back-office/shelter/<code>/close/jobs/<job_id>.
 *
 * Idempotent (CR-243 FR-33): a re-run only creates jobs for shelters without an active one, and a
 * job only touches people still in an affected status (no audit when nothing changed). Exits
 * non-zero if a shelter could not be read or a job could not be created.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	BACKFILL_CREATED_BY,
	parseBackfillArgs,
	selectClosedShelters
} from '$lib/server/closed-shelter-checkout-backfill';
import { dryRunShelterClose, previewShelterClose } from '$lib/server/shelter-close';
import { createShelterCloseJobStore, readShelterCloseConfig } from '$lib/server/shelter-close-job';

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

const args = parseBackfillArgs(process.argv.slice(2));
if (!args.ok) {
	console.error(`✗ ${args.error}`);
	console.error('  Usage: pnpm migrate:closed-shelter-checkout [--dry-run] [--shelter <code>]');
	console.error(
		'         pnpm migrate:closed-shelter-checkout [--shelter <code>] --write --confirm'
	);
	process.exit(1);
}
const DRY_RUN = args.mode === 'dry-run';

const env = loadEnv();
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL;
if (!rawCouchUrl) {
	console.error('✗ COUCHDB_ADMIN_URL is not set');
	console.error('  Set it in the environment or frontend/.env');
	console.error('  Format: http://admin:<password>@<host>:<port>');
	process.exit(1);
}
const { baseUrl: COUCH_URL, authHeader: COUCH_AUTH } = parseCouchUrl(rawCouchUrl);

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

async function loadRegistryShelters(): Promise<Record<string, unknown>[]> {
	const res = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (res.status >= 400) throw new Error(`could not read registry (${failure(res)})`);
	const rows = (res.data as { rows?: { id: string; doc?: Record<string, unknown> }[] })?.rows ?? [];
	return rows
		.filter((r) => r.id.startsWith('shelter:') && r.doc)
		.map((r) => r.doc as Record<string, unknown>);
}

function describeCounts(byStatus: Partial<Record<string, number>>): string {
	const parts = Object.entries(byStatus).map(([status, n]) => `${status}=${n}`);
	return parts.length ? parts.join(', ') : '-';
}

async function main(): Promise<void> {
	console.log(
		DRY_RUN
			? '— DRY RUN (counts only; nothing is written) —'
			: '— WRITE: queueing backfill close jobs for closed shelters (registry is not touched) —'
	);

	const selection = selectClosedShelters(
		await loadRegistryShelters(),
		args.ok ? args.shelter : null
	);
	if (!selection.ok) {
		console.error(`✗ ${selection.error}`);
		process.exit(1);
	}
	const { shelters } = selection;
	console.log(`Closed shelters: ${shelters.length}\n`);

	let problems = 0;
	let totalAffected = 0;
	let totalHouseholds = 0;
	let queued = 0;
	let skipped = 0;
	const store = DRY_RUN
		? null
		: createShelterCloseJobStore({
				couchReq,
				config: readShelterCloseConfig({ ...env, ...process.env })
			});

	for (const shelter of shelters) {
		const label = `${shelter.code} (closed_at: ${shelter.closed_at ?? 'none'})`;
		try {
			if (!store) {
				const { preview, stale_households } = await dryRunShelterClose(couchReq, shelter.code);
				totalAffected += preview.total;
				totalHouseholds += stale_households;
				console.log(
					`${label}\n  would close out ${preview.total} (${describeCounts(preview.by_status)})` +
						` · repair ${stale_households} household(s)`
				);
				continue;
			}

			const preview = await previewShelterClose(couchReq, shelter.code);
			const result = await store.createJob({
				shelter_code: shelter.code,
				mode: 'backfill',
				requested_by: BACKFILL_CREATED_BY,
				preview
			});
			if (result.created) {
				queued += 1;
				console.log(
					`${label}\n  queued job_id=${result.job.job_ulid} (affected: ${preview.total})`
				);
			} else {
				skipped += 1;
				console.log(`${label}\n  skipped: job ${result.job_id} is already active`);
			}
		} catch (err) {
			problems += 1;
			console.log(`${label}\n  ✗ ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	console.log(
		DRY_RUN
			? `\nTotal that would be closed out: ${totalAffected} · households to repair: ${totalHouseholds}`
			: `\nQueued ${queued} job(s), skipped ${skipped} (active job), problems=${problems}. The shelter-close-worker processes them.`
	);
	if (problems > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error('Fatal:', err instanceof Error ? err.message : err);
	process.exit(1);
});
