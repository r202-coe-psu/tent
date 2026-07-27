/**
 * Redeploy Map/Reduce Views to shelter databases.
 *
 * Default is a read-only dry-run. Examples (from frontend/):
 *   pnpm deploy:shelter-views --module dashboard
 *   pnpm deploy:shelter-views --module dashboard --write --confirm
 *   pnpm deploy:shelter-views --module dashboard --verify
 *
 * The target environment is whatever `COUCHDB_ADMIN_URL` points at — there is
 * deliberately no `--environment` flag. Separation between staging and
 * production comes from each CI job binding a different credential, which the
 * operator cannot override from the command line; a flag they type themselves
 * could not add to that. The run header logs the endpoint host so a CI log
 * always records which cluster was written.
 *
 * `--design app` is the current-system mode: it merges Dashboard Views into
 * the existing _design/app without dropping Views owned by other modules.
 * The default target is the module-owned _design/dashboard.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	getShelterViewModule,
	SHELTER_VIEW_MODULES
} from '$lib/features/shelters/domain/view-modules';
import {
	runViewLifecycle,
	type ViewLifecycleMode,
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
const moduleArgIndex = process.argv.indexOf('--module');
const requestedModule = moduleArgIndex >= 0 ? process.argv[moduleArgIndex + 1] : 'dashboard';
const designArgIndex = process.argv.indexOf('--design');
const targetDesignName = designArgIndex >= 0 ? process.argv[designArgIndex + 1] : undefined;
const isWrite = args.has('--write');
const isVerify = args.has('--verify');
const isConfirmed = args.has('--confirm');
const outputJson = args.has('--json');

if (isWrite && !isConfirmed) {
	console.error('✗ --write requires --confirm');
	console.error('  Example: pnpm deploy:shelter-views --module dashboard --write --confirm');
	process.exit(1);
}

if (isWrite && isVerify) {
	console.error('✗ Choose either --write or --verify, not both');
	process.exit(1);
}

if (designArgIndex >= 0 && !targetDesignName) {
	console.error('✗ --design requires a design name, for example app or dashboard');
	process.exit(1);
}

function mode(): ViewLifecycleMode {
	if (isWrite) return 'write';
	if (isVerify) return 'verify';
	return 'dry-run';
}

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

function printResult(result: ViewLifecycleResult): void {
	const suffix = result.message ? ` (${result.message})` : '';
	const line = `  ${result.status === 'failed' ? '✗' : '✓'} ${result.db} ${result.status}${suffix}`;
	(outputJson ? console.error : console.log)(line);
}

async function main() {
	const moduleNames = args.has('--all') ? Object.keys(SHELTER_VIEW_MODULES) : [requestedModule];
	if (requestedModule === 'all' && !args.has('--all')) {
		throw new Error('Use --all instead of --module all');
	}
	const modules = moduleNames.map((name) => getShelterViewModule(name));
	if (
		targetDesignName &&
		modules.some(
			(manifest) =>
				targetDesignName !== manifest.stableDesignName &&
				targetDesignName !== manifest.legacyDesignName
		)
	) {
		throw new Error(`Invalid --design "${targetDesignName}" for selected module`);
	}
	const shelters = await listShelters();
	const runMode = mode();
	const log = outputJson ? console.error : console.log;
	log(`🔄 Shelter Map/Reduce lifecycle (${runMode})`);
	// Host only — never the full baseUrl. `parseCouchUrl` strips credentials, but
	// this line ends up in CI logs, so it must not depend on that staying true.
	log(`   endpoint: ${new URL(baseUrl).host}`);
	log(`   modules: ${moduleNames.join(', ')}`);
	log(`   shelters: ${shelters.length}`);
	log(`   target: ${targetDesignName ?? 'module stable design'}`);

	if (shelters.length === 0) {
		log('⚠️  No shelter masters in registry — nothing to process');
		return;
	}

	let ok = 0;
	let failed = 0;
	const results: ViewLifecycleResult[] = [];
	for (const shelter of shelters) {
		let preflightError: string | null = null;
		try {
			await ensureDatabase(shelter.db);
		} catch (error) {
			preflightError = error instanceof Error ? error.message : String(error);
		}
		for (const manifest of modules) {
			try {
				if (preflightError) throw new Error(preflightError);
				const result = await runViewLifecycle(shelter.db, manifest, couchReq, {
					mode: runMode,
					targetDesignName
				});
				results.push(result);
				printResult(result);
				ok++;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const result: ViewLifecycleResult = {
					db: shelter.db,
					module: manifest.module,
					version: manifest.version,
					mode: runMode,
					targetDesignName: targetDesignName ?? manifest.stableDesignName,
					targetHash: 'unknown',
					status: 'failed',
					message
				};
				results.push(result);
				printResult(result);
				failed++;
			}
		}
	}

	if (outputJson) console.log(JSON.stringify({ mode: runMode, ok, failed, results }, null, 2));
	else console.log(`📊 Summary: ok=${ok} failed=${failed}`);
	if (failed > 0) process.exit(1);
}

main().catch((error) => {
	console.error('Fatal:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
