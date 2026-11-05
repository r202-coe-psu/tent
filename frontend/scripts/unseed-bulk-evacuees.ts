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
import { isLargeVolume, LARGE_VOLUME_WARNING } from './seed/bulk-volume';
import { assertLocalCouch, couchReq, displayCouchUrl } from './seed/couch';
import { findDocsByPrefix, type CouchReq } from './unseed-stock';

const ID_PREFIX = 'seed-bulk';
const DELETE_CHUNK = 500;
const DOC_KINDS = ['evacuee', 'household', 'movement'] as const;

export async function unseedBulkEvacuees(
	shelter: string,
	options: { confirm?: boolean; req?: CouchReq } = {}
): Promise<{ db: string; counts: Record<string, number> }> {
	const req = options.req ?? couchReq;
	const db = shelterDbName(shelter);
	const codeSlug = shelter.toLowerCase();
	const counts: Record<string, number> = {};
	const docs: Array<{ id: string; rev: string }> = [];

	for (const kind of DOC_KINDS) {
		const found = await findDocsByPrefix(db, `${kind}:${ID_PREFIX}:${codeSlug}:`, req);
		counts[kind] = found.length;
		docs.push(...found);
	}

	console.log(`\nBulk evacuee volume in ${db} → ${displayCouchUrl()}`);
	for (const kind of DOC_KINDS) console.log(`  ${kind}: ${counts[kind]}`);

	if (isLargeVolume(docs.length)) console.log(`\n${LARGE_VOLUME_WARNING}`);

	if (!options.confirm) {
		console.log(`\nDry-run only. Add --confirm to delete ${docs.length} docs.\n`);
		return { db, counts };
	}

	let deleted = 0;
	const failures: string[] = [];
	for (let i = 0; i < docs.length; i += DELETE_CHUNK) {
		const chunk = docs.slice(i, i + DELETE_CHUNK);
		const { status, data } = await req('POST', `/${db}/_bulk_docs`, {
			docs: chunk.map((d) => ({ _id: d.id, _rev: d.rev, _deleted: true }))
		});
		if (status !== 201 || !Array.isArray(data)) {
			throw new Error(`Cannot delete docs from ${db} (HTTP ${status})`);
		}
		for (const row of data as Array<{ id?: string; ok?: boolean; error?: string }>) {
			if (row.ok) deleted += 1;
			else failures.push(`${row.id}: ${row.error ?? 'unknown'}`);
		}
	}
	console.log(`\n  ✓ deleted ${deleted} of ${docs.length} docs from ${db}\n`);
	if (failures.length > 0) {
		throw new Error(
			`${failures.length} docs failed to delete, e.g. ${failures.slice(0, 3).join('; ')}`
		);
	}
	return { db, counts };
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	assertLocalCouch();
	const shelter = argv
		.find((a) => a.startsWith('--shelter='))
		?.split('=')[1]
		?.trim();
	if (!shelter) throw new Error('--shelter=<code> is required');
	await unseedBulkEvacuees(shelter, { confirm: argv.includes('--confirm') });
}

if (process.argv[1]?.endsWith('unseed-bulk-evacuees.ts')) {
	main().catch((err: unknown) => {
		console.error('\nUnseed bulk evacuees failed:', err);
		process.exit(1);
	});
}
