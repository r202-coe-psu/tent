/**
 * Redeploy `_design/access` (validate_doc_update allowlist) + referral Mango
 * indexes on every shelter DB listed in the registry, and grant the public
 * writer user `_security.members` access.
 *
 * Run after allowlist changes (e.g. new doc types in shelter-access-design)
 * on existing staging/prod DBs — new shelters provisioned via
 * POST /api/back-office/shelter get all three automatically; seed also deploys
 * them for local SH001/SH002.
 *
 * Usage (from frontend/):
 *   pnpm redeploy:access                 # dry-run
 *   pnpm redeploy:access --write --confirm
 *
 * Needs: COUCHDB_ADMIN_URL in frontend/.env
 *   Format: http://admin:<password>@<host>:<port>
 * Optional: COUCHDB_PUBLIC_WRITER_URL — when set, ensures the `_users` doc exists
 *   (idempotent; skipped when unset) and adds its username to each shelter's
 *   `_security.members.names`.
 *
 * Runs under plain `tsx` (not the SvelteKit runtime), so this script must NOT
 * import `$lib/server/couch-admin` / `shelters.admin` — those pull `$env` and
 * `@sveltejs/kit`. Couch HTTP + env loading live here; design payloads come
 * from the pure `$lib/server/shelter-access-design` module and credential
 * parsing from `$lib/server/couch-credentials`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { couchUserFromUrl } from '$lib/server/couch-credentials';
import { ensurePublicWriter } from '$lib/server/ensure-public-writer';
import { buildRegistryDesignDoc, REGISTRY_DESIGN_ID } from '$lib/server/registry-design';
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

const PUBLIC_WRITER_NAME = couchUserFromUrl(
	process.env.COUCHDB_PUBLIC_WRITER_URL ?? env.COUCHDB_PUBLIC_WRITER_URL
);

const DRY_RUN = !process.argv.includes('--write');
const CONFIRMED = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRMED) {
	console.error('✗ --write requires --confirm (a typo could write to production)');
	console.error('  Re-run with: pnpm redeploy:access --write --confirm');
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

interface AccessRedeployOutcome {
	status: number;
	updated: boolean;
	reason: 'already_current' | 'created' | 'updated' | 'diff_will_update' | 'missing_will_create';
}

async function redeployShelterAccessDesign(
	db: string,
	shelterCode: string,
	dryRun: boolean
): Promise<AccessRedeployOutcome> {
	const existing = await couchReq('GET', `/${db}/_design/access`);
	const existingData =
		existing.status === 200
			? (existing.data as { _rev?: string; validate_doc_update?: string } | null)
			: null;
	const expectedValidate = buildValidateDocUpdate(shelterCode);

	if (existingData && existingData.validate_doc_update === expectedValidate) {
		return { status: 304, updated: false, reason: 'already_current' };
	}

	if (dryRun) {
		return {
			status: 200,
			updated: true,
			reason: existing.status === 404 ? 'missing_will_create' : 'diff_will_update'
		};
	}

	const rev = existingData?._rev;
	const res = await couchReq('PUT', `/${db}/_design/access`, {
		_id: '_design/access',
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: expectedValidate
	});
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`validate_doc_update redeploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return { status: res.status, updated: true, reason: rev ? 'updated' : 'created' };
}

/**
 * Idempotent PUT of the registry `_design/app` (`by_code` view) so
 * `findMasterByCode` and the public booking BFF can resolve a shelter by code
 * instead of scanning the whole registry.
 */
async function deployRegistryDesign(dryRun: boolean): Promise<'current' | 'deployed'> {
	const desired = buildRegistryDesignDoc();
	const existing = await couchReq('GET', `/registry/${REGISTRY_DESIGN_ID}`);
	const current =
		existing.status === 200
			? (existing.data as { _rev?: string; views?: Record<string, { map: string }> } | null)
			: null;

	if (current && current.views?.by_code?.map === desired.views.by_code.map) {
		return 'current';
	}
	if (dryRun) return 'deployed';

	const res = await couchReq('PUT', `/registry/${REGISTRY_DESIGN_ID}`, {
		...desired,
		...(current?._rev ? { _rev: current._rev } : {})
	});
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`registry _design/app deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return 'deployed';
}

/**
 * Add `name` to `_security.members.names` without clobbering existing entries.
 *
 * Mirrors `mergeShelterSecurity()` in `$lib/server/shelters.admin` (which this
 * script cannot import — it pulls `$env`). Returns `false` when the name was
 * already present so the caller can report a no-op instead of a write.
 */
async function grantSecurityMember(db: string, name: string, dryRun: boolean): Promise<boolean> {
	const current = await couchReq('GET', `/${db}/_security`);
	if (current.status >= 400 && current.status !== 404) {
		const detail = (current.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Could not read _security (${current.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	const existing =
		(current.data as {
			admins?: { names?: string[]; roles?: string[] };
			members?: { names?: string[]; roles?: string[] };
		} | null) ?? {};

	const names = existing.members?.names ?? [];
	if (names.includes(name)) return false;
	if (dryRun) return true;

	const merged = {
		admins: {
			names: existing.admins?.names ?? [],
			roles: existing.admins?.roles ?? []
		},
		members: {
			names: [...names, name],
			roles: existing.members?.roles ?? []
		}
	};

	const put = await couchReq('PUT', `/${db}/_security`, merged);
	if (put.status >= 400) {
		const detail = (put.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`_security write failed (${put.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return true;
}

async function deployReferralMangoIndexes(
	db: string,
	dryRun: boolean
): Promise<{ created: number; existing: number }> {
	let created = 0;
	let existing = 0;
	for (const def of REFERRAL_MANGO_INDEXES) {
		if (dryRun) {
			created++;
			continue;
		}
		const res = await couchReq('POST', `/${db}/_index`, def);
		if (res.status >= 400) {
			const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
			throw new Error(
				`Mango index ${def.name} deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
		const result = (res.data as { result?: string } | null)?.result;
		if (result === 'exists') {
			existing++;
		} else {
			created++;
		}
	}
	return { created, existing };
}

// ─── main ───────────────────────────────────────────────────────────────────

function logPublicWriterEnsure(
	result: Awaited<ReturnType<typeof ensurePublicWriter>>
): void {
	switch (result.outcome) {
		case 'skipped':
			console.log('   public writer: ⚠️  COUCHDB_PUBLIC_WRITER_URL unset — skipping user + grant');
			return;
		case 'created':
			console.log(`   public writer: ✓ _users "${result.username}" created`);
			return;
		case 'already_exists':
			console.log(`   public writer: ✓ _users "${result.username}" already exists`);
			return;
		case 'would_create':
			console.log(`   public writer: would create _users "${result.username}"`);
			return;
	}
}

async function main() {
	console.log('🔄 Redeploy _design/access + referral Mango indexes + public writer grant');
	console.log(`   mode: ${DRY_RUN ? 'DRY-RUN (pass --write --confirm to apply)' : 'WRITE'}`);

	const writerUrl = process.env.COUCHDB_PUBLIC_WRITER_URL ?? env.COUCHDB_PUBLIC_WRITER_URL;
	const writerEnsure = await ensurePublicWriter(couchReq, writerUrl, { dryRun: DRY_RUN });
	logPublicWriterEnsure(writerEnsure);
	if (PUBLIC_WRITER_NAME) {
		console.log(`   public writer grant: ${PUBLIC_WRITER_NAME}`);
	} else if (writerEnsure.outcome !== 'skipped') {
		console.log('   public writer grant: ⚠️  username could not be parsed from URL');
	}
	console.log('');

	const masters = await listShelterMasters();
	if (masters.length === 0) {
		console.log('⚠️  No shelter masters in registry — skipping shelter redeploy');
		return;
	}

	console.log(`📋 Found ${masters.length} shelter master(s)`);

	const registryDesign = await deployRegistryDesign(DRY_RUN);
	console.log(
		registryDesign === 'current'
			? '  ✓ registry _design/app (by_code) already current'
			: DRY_RUN
				? '  would deploy registry _design/app (by_code view)'
				: '  ✓ registry _design/app (by_code view) deployed'
	);
	console.log('');

	let ok = 0;
	let failed = 0;

	for (const master of masters) {
		const code = master.code;
		const db = shelterDbName(code);
		console.log(`  → ${code} (${db})`);

		try {
			const accessResult = await redeployShelterAccessDesign(db, code, DRY_RUN);
			const writerGranted = PUBLIC_WRITER_NAME
				? await grantSecurityMember(db, PUBLIC_WRITER_NAME, DRY_RUN)
				: false;

			if (DRY_RUN) {
				if (accessResult.updated) {
					console.log(
						`    would redeploy _design/access (${accessResult.reason}) + ${REFERRAL_MANGO_INDEXES.length} mango indexes`
					);
				} else {
					console.log(`    _design/access already current (skip PUT)`);
				}
				if (PUBLIC_WRITER_NAME) {
					console.log(
						writerGranted
							? `    would grant _security member "${PUBLIC_WRITER_NAME}"`
							: `    _security member "${PUBLIC_WRITER_NAME}" already granted`
					);
				}
				ok++;
				continue;
			}

			if (accessResult.updated) {
				console.log(`    ✓ _design/access (${accessResult.reason}, HTTP ${accessResult.status})`);
			} else {
				console.log(`    ✓ _design/access (already current, skipped PUT)`);
			}

			const indexResult = await deployReferralMangoIndexes(db, false);
			console.log(
				`    ✓ referral mango indexes (${indexResult.created} created, ${indexResult.existing} existing)`
			);
			if (PUBLIC_WRITER_NAME) {
				console.log(
					writerGranted
						? `    ✓ _security member "${PUBLIC_WRITER_NAME}" granted`
						: `    ✓ _security member "${PUBLIC_WRITER_NAME}" (already granted, skipped PUT)`
				);
			}
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
