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
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// Point process.env so $lib/server/couch-admin picks up the same admin URL.
process.env.COUCHDB_ADMIN_URL = rawCouchUrl;

const DRY_RUN = !process.argv.includes('--write');
const CONFIRMED = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRMED) {
	console.error('✗ --write requires --confirm (a typo could write to production)');
	console.error('  Re-run with: pnpm redeploy:referral-db --write --confirm');
	process.exit(1);
}

const { listShelterMasters, redeployShelterAccessDesign, deployReferralMangoIndexes } =
	await import('../src/lib/server/shelters.admin');
const { shelterDbName } = await import('../src/lib/server/shelter-access-design');

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
			console.log(`    would redeploy _design/access + ${4} mango indexes`);
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
