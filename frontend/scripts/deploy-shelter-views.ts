/**
 * Redeploy Map/Reduce Views to shelter databases.
 *
 * Default is a read-only dry-run. Examples (from frontend/):
 *   pnpm deploy:shelter-views
 *   pnpm deploy:shelter-views --deploy-candidate --write --confirm
 *   pnpm deploy:shelter-views --promote --write --confirm
 *   pnpm deploy:shelter-views --verify
 *   pnpm deploy:shelter-views --retire --write --confirm
 *
 * `--deploy-candidate` and `--promote` are separate invocations on purpose
 * (CR-056 §4/§7 item 1): every shelter must finish Stage C/D (candidate
 * deployed + warmed + verified) before Stage E (promote) touches even the
 * first shelter. Running both phases inside one loop-per-shelter — the way
 * this script used to work — meant a mid-run failure left some shelters
 * promoted to the new view while the application was still the old release,
 * which is exactly the "application ahead of View" ordering §7 item 1
 * forbids. `--retire` is Stage G and is never run as part of a deploy.
 *
 * The target environment is whatever `COUCHDB_ADMIN_URL` points at — there is
 * deliberately no `--environment` flag. Separation between staging and
 * production comes from each CI job binding a different credential, which the
 * operator cannot override from the command line; a flag they type themselves
 * could not add to that. The run header logs the endpoint host so a CI log
 * always records which cluster was written.
 *
 * There is one design document (`_design/app`) and one manifest, so there is no
 * `--design` or `--module` flag to pick between them. The manifest is the whole
 * view set: deploying REPLACES `views`, so a view dropped from the manifest is
 * dropped from CouchDB too.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SHELTER_VIEW_MANIFEST } from '$lib/features/shelters/domain/view-manifest';
import {
	deployCandidate,
	promoteCandidate,
	retireSnapshots,
	runViewLifecycle,
	type ViewLifecycleResult
} from '$lib/features/shelters/server/view-lifecycle';
import { shelterDbName } from '$lib/server/shelter-access-design';

function loadDotEnv(): Record<string, string> {
	const envPath = resolve(process.cwd(), '.env');
	if (!existsSync(envPath)) return {};
	return Object.fromEntries(
		readFileSync(envPath, 'utf8')
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

const fileEnv = loadDotEnv();
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? fileEnv.COUCHDB_ADMIN_URL;
if (!rawCouchUrl) {
	console.error('✗ COUCHDB_ADMIN_URL is not set');
	console.error('  Set it in the environment or frontend/.env');
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

const { baseUrl, authHeader } = parseCouchUrl(rawCouchUrl);
const args = new Set(process.argv.slice(2));

type Stage = 'deploy-candidate' | 'promote' | 'verify' | 'retire' | 'dry-run';

const stageFlags: Stage[] = [
	...(args.has('--deploy-candidate') ? (['deploy-candidate'] as const) : []),
	...(args.has('--promote') ? (['promote'] as const) : []),
	...(args.has('--verify') ? (['verify'] as const) : []),
	...(args.has('--retire') ? (['retire'] as const) : [])
];

if (stageFlags.length > 1) {
	console.error('✗ Choose exactly one of --deploy-candidate, --promote, --verify, --retire');
	process.exit(1);
}

const stage: Stage = stageFlags[0] ?? 'dry-run';
const isWrite = args.has('--write');
const isConfirmed = args.has('--confirm');
const outputJson = args.has('--json');
const gitCommit = process.env.TENT_GIT_COMMIT ?? fileEnv.TENT_GIT_COMMIT ?? 'unknown';

if (stage === 'dry-run' && (isWrite || isConfirmed)) {
	console.error('✗ --write/--confirm require a stage flag (--deploy-candidate/--promote/--retire)');
	process.exit(1);
}

if (stage !== 'dry-run' && stage !== 'verify' && isWrite && !isConfirmed) {
	console.error(`✗ --${stage} --write requires --confirm`);
	console.error(`  Example: pnpm deploy:shelter-views --${stage} --write --confirm`);
	process.exit(1);
}

const isDryRunStage = stage === 'dry-run' || stage === 'verify' || !isWrite;

async function couchReq(
	path: string,
	method: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	if (authHeader) headers.Authorization = authHeader;
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	const timeoutMs = normalizedPath.includes('/_view/') ? 10 * 60 * 1000 : 15_000;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const response = await fetch(`${baseUrl}${normalizedPath}`, {
				method,
				headers,
				signal: AbortSignal.timeout(timeoutMs),
				...(body === undefined ? {} : { body: JSON.stringify(body) })
			});
			const data = response.status === 204 ? null : await response.json().catch(() => null);
			const transient =
				response.status === 408 || response.status === 429 || response.status >= 500;
			if (!transient || attempt === 3) return { status: response.status, data };
		} catch (error) {
			if (attempt === 3) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, attempt * 200));
	}
	throw new Error(`CouchDB request failed: ${method} ${normalizedPath}`);
}

async function listShelters(): Promise<{ code: string; db: string }[]> {
	const pageSize = 1000;
	const shelters: { code: string; db: string }[] = [];
	let startkeyDocid: string | undefined;
	for (;;) {
		const query = new URLSearchParams({ include_docs: 'true', limit: String(pageSize) });
		if (startkeyDocid) {
			query.set('startkey_docid', startkeyDocid);
			query.set('skip', '1');
		}
		const response = await couchReq(`/registry/_all_docs?${query}`, 'GET');
		if (response.status === 404) return shelters;
		if (response.status >= 400) throw new Error(`Could not read registry (${response.status})`);
		const rows = (response.data as { rows?: { id: string; doc?: { code?: string } }[] })?.rows;
		if (!Array.isArray(rows)) throw new Error('Registry response did not contain rows[]');
		for (const row of rows) {
			if (row.id.startsWith('shelter:') && row.doc?.code) {
				shelters.push({ code: row.doc.code, db: shelterDbName(row.doc.code) });
			}
		}
		if (rows.length < pageSize) return shelters;
		const nextStart = rows[rows.length - 1]?.id;
		if (!nextStart || nextStart === startkeyDocid)
			throw new Error('Registry pagination did not advance');
		startkeyDocid = nextStart;
	}
}

async function ensureDatabase(db: string): Promise<void> {
	const response = await couchReq(`/${encodeURIComponent(db)}`, 'GET');
	if (response.status === 404) throw new Error(`Shelter database is missing: ${db}`);
	if (response.status >= 400)
		throw new Error(`Shelter database preflight failed: ${db} (${response.status})`);
}

type OutcomeStatus = 'ok' | 'lifecycle_failed' | 'preflight_failed';
type ShelterOutcome = {
	shelter_code: string;
	db: string;
	status: OutcomeStatus;
	result?: ViewLifecycleResult & {
		shelter_code: string;
		git_commit: string;
		deployed_at?: string;
		verified_at?: string;
	};
	message?: string;
};

function printOutcome(outcome: ShelterOutcome): void {
	const suffix = outcome.message ? ` (${outcome.message})` : '';
	const marker = outcome.status === 'ok' ? '✓' : '✗';
	const line = `  ${marker} ${outcome.db} ${outcome.result?.status ?? outcome.status}${suffix}`;
	(outputJson ? console.error : console.log)(line);
}

async function runStageOnAllShelters(
	shelters: { code: string; db: string }[],
	run: (db: string) => Promise<ViewLifecycleResult>
): Promise<ShelterOutcome[]> {
	const outcomes: ShelterOutcome[] = [];
	for (const shelter of shelters) {
		try {
			await ensureDatabase(shelter.db);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const outcome: ShelterOutcome = {
				shelter_code: shelter.code,
				db: shelter.db,
				status: 'preflight_failed',
				message
			};
			outcomes.push(outcome);
			printOutcome(outcome);
			continue;
		}
		const now = new Date().toISOString();
		try {
			const result = await run(shelter.db);
			const outcome: ShelterOutcome = {
				shelter_code: shelter.code,
				db: shelter.db,
				status: result.status === 'failed' ? 'lifecycle_failed' : 'ok',
				result: {
					...result,
					shelter_code: shelter.code,
					git_commit: gitCommit,
					...(result.status !== 'candidate-ready' ? { deployed_at: now } : {}),
					...(result.status === 'verified' ? { verified_at: now } : {})
				}
			};
			outcomes.push(outcome);
			printOutcome(outcome);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const outcome: ShelterOutcome = {
				shelter_code: shelter.code,
				db: shelter.db,
				status: 'lifecycle_failed',
				message
			};
			outcomes.push(outcome);
			printOutcome(outcome);
		}
	}
	return outcomes;
}

function summarize(outcomes: ShelterOutcome[]) {
	return {
		ok: outcomes.filter((o) => o.status === 'ok').length,
		lifecycle_failed: outcomes.filter((o) => o.status === 'lifecycle_failed').length,
		preflight_failed: outcomes.filter((o) => o.status === 'preflight_failed').length
	};
}

/**
 * Exit code contract (CR-056 §8 — preflight vs lifecycle failure must be
 * distinguishable): `0` all shelters ok · `1` at least one lifecycle failure
 * (the runner's own responsibility) · `2` only preflight failures (registry
 * has a shelter master with no matching database — someone else's
 * provisioning gap, not a lifecycle bug).
 */
function exitCodeFor(outcomes: ShelterOutcome[]): number {
	const { lifecycle_failed, preflight_failed } = summarize(outcomes);
	if (lifecycle_failed > 0) return 1;
	if (preflight_failed > 0) return 2;
	return 0;
}

async function main() {
	const shelters = await listShelters();
	const log = outputJson ? console.error : console.log;
	log(`🔄 Shelter Map/Reduce lifecycle (${stage}${isDryRunStage ? ', dry-run' : ''})`);
	// Host only — never the full baseUrl. `parseCouchUrl` strips credentials, but
	// this line ends up in CI logs, so it must not depend on that staying true.
	log(`   endpoint: ${new URL(baseUrl).host}`);
	log(`   design: _design/${SHELTER_VIEW_MANIFEST.designName} (v${SHELTER_VIEW_MANIFEST.version})`);
	log(`   views: ${Object.keys(SHELTER_VIEW_MANIFEST.views).join(', ')}`);
	log(`   shelters: ${shelters.length}`);

	if (shelters.length === 0) {
		log('⚠️  No shelter masters in registry — nothing to process');
		return;
	}

	if (stage === 'retire') {
		if (!isWrite) {
			log('   (dry-run — pass --write --confirm to actually delete + _view_cleanup)');
		}
		const removed: { db: string; ids: string[] }[] = [];
		for (const shelter of shelters) {
			try {
				await ensureDatabase(shelter.db);
			} catch {
				continue;
			}
			const { removed: removedIds } = await retireSnapshots(
				shelter.db,
				SHELTER_VIEW_MANIFEST,
				couchReq,
				{ dryRun: !isWrite }
			);
			if (removedIds.length > 0) removed.push({ db: shelter.db, ids: removedIds });
			(outputJson ? console.error : console.log)(
				`  ${shelter.db}: ${removedIds.length} snapshot(s) ${isWrite ? 'removed' : 'would be removed'}`
			);
		}
		if (outputJson) console.log(JSON.stringify({ stage, write: isWrite, removed }, null, 2));
		return;
	}

	if (stage === 'verify' || stage === 'dry-run') {
		const outcomes = await runStageOnAllShelters(shelters, (db) =>
			runViewLifecycle(db, SHELTER_VIEW_MANIFEST, couchReq, {
				mode: stage === 'verify' ? 'verify' : 'dry-run'
			})
		);
		if (outputJson)
			console.log(JSON.stringify({ stage, ...summarize(outcomes), outcomes }, null, 2));
		else console.log(`📊 Summary:`, summarize(outcomes));
		process.exit(exitCodeFor(outcomes));
	}

	if (!isWrite) {
		// --deploy-candidate / --promote without --write: preview only, same
		// contract as dry-run, but scoped to the stage's own read path.
		const outcomes = await runStageOnAllShelters(shelters, (db) =>
			runViewLifecycle(db, SHELTER_VIEW_MANIFEST, couchReq, { mode: 'dry-run' })
		);
		if (outputJson)
			console.log(JSON.stringify({ stage, ...summarize(outcomes), outcomes }, null, 2));
		else console.log(`📊 Summary:`, summarize(outcomes));
		process.exit(exitCodeFor(outcomes));
	}

	const outcomes = await runStageOnAllShelters(shelters, (db) =>
		stage === 'deploy-candidate'
			? deployCandidate(db, SHELTER_VIEW_MANIFEST, couchReq)
			: promoteCandidate(db, SHELTER_VIEW_MANIFEST, couchReq)
	);

	if (stage === 'promote') {
		const { lifecycle_failed } = summarize(outcomes);
		if (lifecycle_failed > 0) {
			log('✗ Some shelters failed to promote — application must NOT be deployed this release');
		}
	}

	if (outputJson) console.log(JSON.stringify({ stage, ...summarize(outcomes), outcomes }, null, 2));
	else console.log(`📊 Summary:`, summarize(outcomes));
	process.exit(exitCodeFor(outcomes));
}

main().catch((error) => {
	console.error('Fatal:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
