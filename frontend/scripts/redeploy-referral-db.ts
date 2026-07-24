/**
 * Redeploy `_design/access` (referral whitelist) + referral Mango indexes
 * on every shelter DB listed in the registry.
 *
 * Required after merging T-34 / CR-045 onto existing staging/prod DBs —
 * new shelters provisioned via POST /api/back-office/shelter get both
 * automatically; seed also deploys them for local SH001/SH002.
 *
 * Usage (from frontend/):
 *   pnpm redeploy:referral-db                 # dry-run
 *   pnpm redeploy:referral-db --write --confirm
 *
 * Needs: COUCHDB_ADMIN_URL in frontend/.env
 *   Format: http://admin:<password>@<host>:<port>
 *
 * Runs under plain `tsx` (not the SvelteKit runtime), so this script must NOT
 * import `$lib/server/couch-admin` / `shelters.admin` — those pull `$env` and
 * `@sveltejs/kit`. Couch HTTP + env loading live here; design payloads come
 * from the pure `$lib/server/shelter-access-design` module.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	buildValidateDocUpdate,
	REFERRAL_MANGO_INDEXES,
	shelterDbName
} from '$lib/server/shelter-access-design';

// ─── env loader ─────────────────────────────────────────────────────────────

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
const rawCouchUrl = env.COUCHDB_ADMIN_URL;

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

const DRY_RUN = !process.argv.includes('--write');
const CONFIRMED = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRMED) {
	console.error('✗ --write requires --confirm (a typo could write to production)');
	console.error('  Re-run with: pnpm redeploy:referral-db --write --confirm');
	process.exit(1);
}

// ─── CouchDB helpers (tsx-safe; mirror seed/migrate-shelter) ────────────────

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

interface ShelterMasterRow {
	code: string;
}

async function listShelterMasters(): Promise<ShelterMasterRow[]> {
	const res = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (res.status === 404) return [];
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Could not read registry (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	const rows = (res.data as { rows?: { id: string; doc?: { code?: string } }[] })?.rows ?? [];
	return rows
		.filter((r) => r.id.startsWith('shelter:') && r.doc?.code)
		.map((r) => ({ code: r.doc!.code! }));
}

async function redeployShelterAccessDesign(db: string, shelterCode: string): Promise<number> {
	const existing = await couchReq('GET', `/${db}/_design/access`);
	const rev = existing.status === 200 ? (existing.data as { _rev: string })._rev : undefined;
	const res = await couchReq('PUT', `/${db}/_design/access`, {
		_id: '_design/access',
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: buildValidateDocUpdate(shelterCode)
	});
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`validate_doc_update redeploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return res.status;
}

async function deployReferralMangoIndexes(db: string): Promise<void> {
	for (const def of REFERRAL_MANGO_INDEXES) {
		const res = await couchReq('POST', `/${db}/_index`, def);
		if (res.status >= 400) {
			const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
			throw new Error(
				`Mango index ${def.name} deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
	}
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
	console.log('🔄 Redeploy _design/access + referral Mango indexes');
	console.log(`   mode: ${DRY_RUN ? 'DRY-RUN (pass --write --confirm to apply)' : 'WRITE'}`);
	console.log('');

	const masters = await listShelterMasters();
	if (masters.length === 0) {
		console.log('⚠️  No shelter masters in registry — nothing to redeploy');
		return;
	}

	console.log(`📋 Found ${masters.length} shelter master(s)`);
	console.log('');

	let ok = 0;
	let failed = 0;

	for (const master of masters) {
		const code = master.code;
		const db = shelterDbName(code);
		console.log(`  → ${code} (${db})`);

		if (DRY_RUN) {
			console.log(
				`    would redeploy _design/access + ${REFERRAL_MANGO_INDEXES.length} mango indexes`
			);
			ok++;
			continue;
		}

		try {
			const status = await redeployShelterAccessDesign(db, code);
			console.log(`    ✓ _design/access (${status})`);
			await deployReferralMangoIndexes(db);
			console.log(`    ✓ referral mango indexes`);
			ok++;
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`    ✗ ${msg}`);
			failed++;
		}
	}

	console.log('');
	console.log(`📊 Summary: ok=${ok} failed=${failed}`);
	if (DRY_RUN && ok > 0) {
		console.log('');
		console.log('💡 Re-run with --write --confirm to apply on this CouchDB');
	}
	if (failed > 0) process.exit(1);
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(1);
});
