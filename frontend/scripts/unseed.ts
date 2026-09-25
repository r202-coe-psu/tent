#!/usr/bin/env tsx
/**
 * Unseed script — delete CouchDB databases or specific master datasets.
 *
 * Usage:
 *   pnpm unseed                         (dry-run — lists all databases that would be deleted)
 *   pnpm unseed --confirm               (delete all databases except _users)
 *   pnpm unseed:master-data             (dry-run — lists master_data docs/DB that would be deleted)
 *   pnpm unseed:master-data --confirm   (delete master_data docs in registry + master_data DB)
 *   pnpm unseed:master                  (dry-run — lists master_data, config, and catalog DB)
 *   pnpm unseed:master --confirm        (delete master_data + config + catalog DB)
 *
 * Needs: CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 */

import { couchReq, displayCouchUrl } from './seed/couch';

export const KEEP = new Set(['_users']);

export async function listDatabases(req = couchReq): Promise<string[]> {
	const { status, data } = await req('GET', '/_all_dbs');
	if (status !== 200) throw new Error(`Cannot list databases (HTTP ${status})`);
	return (data as string[]) ?? [];
}

export async function deleteDatabase(name: string, req = couchReq): Promise<void> {
	const { status, data } = await req('DELETE', `/${encodeURIComponent(name)}`);
	if (status !== 200 && status !== 202 && status !== 404) {
		const detail = (data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot delete database "${name}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
}

export async function findMasterDataDocs(
	req = couchReq
): Promise<Array<{ id: string; rev: string }>> {
	const startkey = encodeURIComponent(JSON.stringify('master_data'));
	const endkey = encodeURIComponent(JSON.stringify('master_data\ufff0'));
	const { status, data } = await req(
		'GET',
		`/registry/_all_docs?startkey=${startkey}&endkey=${endkey}`
	);
	if (status === 404) return [];
	if (status !== 200) {
		throw new Error(`Cannot list master_data docs from registry (HTTP ${status})`);
	}
	const rows = (data as { rows?: Array<{ id?: string; value?: { rev?: string } }> })?.rows ?? [];
	return rows
		.filter((r): r is { id: string; value: { rev: string } } =>
			Boolean(r.id && r.id.startsWith('master_data') && r.value?.rev)
		)
		.map((r) => ({ id: r.id, rev: r.value.rev }));
}

export async function findConfigDocs(req = couchReq): Promise<Array<{ id: string; rev: string }>> {
	const startkey = encodeURIComponent(JSON.stringify('config:'));
	const endkey = encodeURIComponent(JSON.stringify('config:\ufff0'));
	const { status, data } = await req(
		'GET',
		`/registry/_all_docs?startkey=${startkey}&endkey=${endkey}`
	);
	if (status === 404) return [];
	if (status !== 200) {
		throw new Error(`Cannot list config docs from registry (HTTP ${status})`);
	}
	const rows = (data as { rows?: Array<{ id?: string; value?: { rev?: string } }> })?.rows ?? [];
	return rows
		.filter((r): r is { id: string; value: { rev: string } } =>
			Boolean(r.id && r.id.startsWith('config:') && r.value?.rev)
		)
		.map((r) => ({ id: r.id, rev: r.value.rev }));
}

export async function deleteDocs(
	db: string,
	docs: Array<{ id: string; rev: string }>,
	req = couchReq
): Promise<void> {
	if (docs.length === 0) return;
	const bulkPayload = {
		docs: docs.map((d) => ({
			_id: d.id,
			_rev: d.rev,
			_deleted: true
		}))
	};
	const { status, data } = await req('POST', `/${encodeURIComponent(db)}/_bulk_docs`, bulkPayload);
	if (status !== 201) {
		const detail = (data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot delete docs from "${db}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
}

export async function unseedMasterData(
	options: {
		confirm?: boolean;
		req?: typeof couchReq;
		displayUrl?: string;
	} = {}
): Promise<{ docs: string[]; dbs: string[] }> {
	const req = options.req ?? couchReq;
	const confirm = options.confirm ?? false;
	const url = options.displayUrl ?? displayCouchUrl();

	console.log(`\nUnseed MASTER DATA → ${url}`);

	const docs = await findMasterDataDocs(req);
	const allDbs = await listDatabases(req);
	const dbsToDelete = allDbs.filter((db) => db === 'master_data');

	if (docs.length === 0 && dbsToDelete.length === 0) {
		console.log('\nNo master_data documents or database found to delete.\n');
		return { docs: [], dbs: [] };
	}

	if (docs.length > 0) {
		console.log(`\nDocuments to delete in "registry" (${docs.length}):`);
		for (const doc of docs) console.log(`  - ${doc.id}`);
	}

	if (dbsToDelete.length > 0) {
		console.log(`\nDatabases to delete (${dbsToDelete.length}):`);
		for (const db of dbsToDelete) console.log(`  - ${db}`);
	}

	if (!confirm) {
		console.log('\nDry run — re-run with --confirm to delete.\n');
		return { docs: docs.map((d) => d.id), dbs: dbsToDelete };
	}

	console.log('');
	if (docs.length > 0) {
		await deleteDocs('registry', docs, req);
		console.log(`  ✓ deleted ${docs.length} master_data docs from registry`);
	}

	for (const db of dbsToDelete) {
		await deleteDatabase(db, req);
		console.log(`  ✓ deleted database ${db}`);
	}

	console.log('\nDone.\n');
	return { docs: docs.map((d) => d.id), dbs: dbsToDelete };
}

export async function unseedMaster(
	options: {
		confirm?: boolean;
		req?: typeof couchReq;
		displayUrl?: string;
	} = {}
): Promise<{ docs: string[]; dbs: string[] }> {
	const req = options.req ?? couchReq;
	const confirm = options.confirm ?? false;
	const url = options.displayUrl ?? displayCouchUrl();

	console.log(`\nUnseed MASTER (platform master_data + config + catalog) → ${url}`);

	const masterDocs = await findMasterDataDocs(req);
	const configDocs = await findConfigDocs(req);
	const allDocs = [...masterDocs, ...configDocs];

	const allDbs = await listDatabases(req);
	const dbsToDelete = allDbs.filter((db) => db === 'master_data' || db === 'catalog');

	if (allDocs.length === 0 && dbsToDelete.length === 0) {
		console.log('\nNo master documents or databases found to delete.\n');
		return { docs: [], dbs: [] };
	}

	if (allDocs.length > 0) {
		console.log(`\nDocuments to delete in "registry" (${allDocs.length}):`);
		for (const doc of allDocs) console.log(`  - ${doc.id}`);
	}

	if (dbsToDelete.length > 0) {
		console.log(`\nDatabases to delete (${dbsToDelete.length}):`);
		for (const db of dbsToDelete) console.log(`  - ${db}`);
	}

	if (!confirm) {
		console.log('\nDry run — re-run with --confirm to delete.\n');
		return { docs: allDocs.map((d) => d.id), dbs: dbsToDelete };
	}

	console.log('');
	if (allDocs.length > 0) {
		await deleteDocs('registry', allDocs, req);
		console.log(`  ✓ deleted ${allDocs.length} master/config docs from registry`);
	}

	for (const db of dbsToDelete) {
		await deleteDatabase(db, req);
		console.log(`  ✓ deleted database ${db}`);
	}

	console.log('\nDone.\n');
	return { docs: allDocs.map((d) => d.id), dbs: dbsToDelete };
}

export async function unseedAll(
	options: {
		confirm?: boolean;
		req?: typeof couchReq;
		displayUrl?: string;
	} = {}
): Promise<{ dbs: string[] }> {
	const req = options.req ?? couchReq;
	const confirm = options.confirm ?? false;
	const url = options.displayUrl ?? displayCouchUrl();

	const dbs = await listDatabases(req);
	const toDelete = dbs.filter((db) => !KEEP.has(db));

	console.log(`\nUnseed ALL databases → ${url}`);
	console.log(`Keeping: ${[...KEEP].join(', ') || '(none)'}`);

	if (toDelete.length === 0) {
		console.log('\nNothing to delete.\n');
		return { dbs: [] };
	}

	console.log(`\nDatabases to delete (${toDelete.length}):`);
	for (const db of toDelete) console.log(`  - ${db}`);

	if (!confirm) {
		console.log('\nDry run — re-run with --confirm to delete.\n');
		return { dbs: toDelete };
	}

	console.log('');
	for (const db of toDelete) {
		await deleteDatabase(db, req);
		console.log(`  ✓ deleted ${db}`);
	}
	console.log('\nDone.\n');
	return { dbs: toDelete };
}

export async function main(argv: string[] = process.argv): Promise<void> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(`
Usage:
  pnpm unseed                         (dry-run: list all DBs except _users)
  pnpm unseed --confirm               (delete all DBs except _users)
  pnpm unseed:master-data             (dry-run: list master_data docs in registry)
  pnpm unseed:master-data --confirm   (delete master_data docs in registry)
  pnpm unseed:master                  (dry-run: list master_data + config + catalog)
  pnpm unseed:master --confirm        (delete master_data + config + catalog)
`);
		return;
	}

	const confirm = argv.includes('--confirm');
	const isMasterData = argv.includes('--master-data') || argv.includes('--master_data');
	const isMaster = argv.includes('--master');

	if (isMasterData) {
		await unseedMasterData({ confirm });
	} else if (isMaster) {
		await unseedMaster({ confirm });
	} else {
		await unseedAll({ confirm });
	}
}

if (process.argv[1]?.endsWith('unseed.ts')) {
	main().catch((err: unknown) => {
		console.error('\nUnseed failed:', err);
		process.exit(1);
	});
}
