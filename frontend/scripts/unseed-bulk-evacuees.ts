#!/usr/bin/env tsx
/**
 * Remove the bulk evacuee volume written by seed-bulk-evacuees.ts (`seed-bulk:` ids only).
 * Staging volume (`seed-st:`) and everything else in the shelter DB is left untouched.
 *
 * Usage (from frontend/):
 *   pnpm unseed:bulk-evacuees --shelter=SH001              (dry-run: counts only)
 *   pnpm unseed:bulk-evacuees --shelter=SH001 --confirm    (delete)
 *
 * Needs: CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 */
import { shelterDbName } from '$lib/server/shelter-access-design';
import { displayCouchUrl } from './seed/couch';
import { findDocsByPrefix } from './unseed-stock';
import { deleteDocs } from './unseed';

const ID_PREFIX = 'seed-bulk';
const DELETE_CHUNK = 500;
const DOC_KINDS = ['evacuee', 'household', 'movement'] as const;

export async function unseedBulkEvacuees(
	shelter: string,
	options: { confirm?: boolean } = {}
): Promise<{ db: string; counts: Record<string, number> }> {
	const db = shelterDbName(shelter);
	const codeSlug = shelter.toLowerCase();
	const counts: Record<string, number> = {};
	const docs: Array<{ id: string; rev: string }> = [];

	for (const kind of DOC_KINDS) {
		const found = await findDocsByPrefix(db, `${kind}:${ID_PREFIX}:${codeSlug}:`);
		counts[kind] = found.length;
		docs.push(...found);
	}

	console.log(`\nBulk evacuee volume in ${db} → ${displayCouchUrl()}`);
	for (const kind of DOC_KINDS) console.log(`  ${kind}: ${counts[kind]}`);

	if (!options.confirm) {
		console.log(`\nDry-run only. Add --confirm to delete ${docs.length} docs.\n`);
		return { db, counts };
	}

	for (let i = 0; i < docs.length; i += DELETE_CHUNK) {
		await deleteDocs(db, docs.slice(i, i + DELETE_CHUNK));
	}
	console.log(`\n  ✓ deleted ${docs.length} docs from ${db}\n`);
	return { db, counts };
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const shelter = (argv.find((a) => a.startsWith('--shelter='))?.split('=')[1] ?? 'SH001').trim();
	await unseedBulkEvacuees(shelter, { confirm: argv.includes('--confirm') });
}

if (process.argv[1]?.endsWith('unseed-bulk-evacuees.ts')) {
	main().catch((err: unknown) => {
		console.error('\nUnseed bulk evacuees failed:', err);
		process.exit(1);
	});
}
