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
 * Walks every registry shelter whose operation_status resolves to `closed` and runs the same
 * `closeShelterPeople` service as the close route: `check_in`ed people get a `check_out` movement
 * (reason `shelter_closed`), `pre_registered` are cancelled, households re-derived. Movements and
 * audits are stamped with the run time (no backdating). The registry is NEVER written: the shelter
 * stays `closed` and `closed_at` is untouched (CR-183 retention clock). Each shelter that changed
 * something (or failed) gets one summary audit in its own DB with
 * `context = { backfill, shelter_closed_at, checked_out, cancelled, failed }`.
 *
 * Idempotent: a re-run only touches people still in an affected status, and writes no audit when
 * nothing changed. Exits non-zero if any evacuee failed, a shelter DB could not be read, or people
 * remain after the run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	BACKFILL_AUDIT_CONTEXT,
	BACKFILL_CREATED_BY,
	buildBackfillSummaryAudit,
	parseBackfillArgs,
	selectClosedShelters
} from '$lib/server/closed-shelter-checkout-backfill';
import { closeShelterPeople, previewShelterClose } from '$lib/server/shelter-close';
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
			: '— WRITE: checking out people in closed shelters (registry is not touched) —'
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
	let totalCheckedOut = 0;
	let totalCancelled = 0;

	for (const shelter of shelters) {
		const label = `${shelter.code} (closed_at: ${shelter.closed_at ?? 'none'})`;
		try {
			if (DRY_RUN) {
				const preview = await previewShelterClose(couchReq, shelter.code);
				totalAffected += preview.total;
				console.log(
					`${label}\n  would close out ${preview.total} (${describeCounts(preview.by_status)})`
				);
				continue;
			}

			const run = await closeShelterPeople(couchReq, shelter.code, {
				createdBy: BACKFILL_CREATED_BY,
				auditContext: { ...BACKFILL_AUDIT_CONTEXT }
			});
			totalCheckedOut += run.checked_out;
			totalCancelled += run.cancelled;
			console.log(
				`${label}\n  checked_out=${run.checked_out} cancelled=${run.cancelled} failed=${run.failed.length} remaining=${run.remaining.total}`
			);
			for (const f of run.failed) console.log(`    ✗ ${f.evacuee_id}: ${f.error}`);
			problems += run.failed.length + (run.remaining.total > 0 ? 1 : 0);

			const audit = buildBackfillSummaryAudit(shelter, run);
			if (audit) {
				const res = await couchReq(
					'PUT',
					`/${shelterDbName(shelter.code)}/${encodeURIComponent(audit._id)}`,
					audit
				);
				if (res.status >= 300) {
					problems += 1;
					console.log(`    ✗ summary audit not written (${failure(res)})`);
				}
			}
		} catch (err) {
			problems += 1;
			console.log(`${label}\n  ✗ ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	console.log(
		DRY_RUN
			? `\nTotal that would be closed out: ${totalAffected}`
			: `\nTotal: checked_out=${totalCheckedOut} cancelled=${totalCancelled} problems=${problems}`
	);
	if (problems > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error('Fatal:', err instanceof Error ? err.message : err);
	process.exit(1);
});
