#!/usr/bin/env tsx
/**
 * Unseed stock/supply docs for a clean inventory retest loop.
 *
 * Shelter DB(s) — deletes:
 *   - stock_ledger:*
 *   - stock_threshold_override:*
 *   - stock_lot_reservation:*
 *   - item_master:* (shelter-local overrides / copies)
 *
 * Catalog DB — always deletes (central item list that stock table merges in):
 *   - item_master:*
 *   - item:*  (legacy supply_item docs; `_id` prefix is `item:`)
 *
 * Does NOT touch item_category, recipe, unit_of_measure, donations,
 * distribution tickets, kitchen docs, stock_transfer (central_ops), or people.
 *
 * Usage (from frontend/):
 *   pnpm unseed:stock --shelter=SH001              (dry-run)
 *   pnpm unseed:stock --shelter=SH001 --confirm    (delete)
 *   pnpm unseed:stock --shelter=all --confirm      (every shelter_* + catalog items)
 *
 * `--shelter` accepts a code (`SH001` / `sh001`), a DB name (`shelter_sh001`),
 * or `all`. Catalog item wipe runs on every invocation (not scoped by shelter).
 *
 * Needs: CouchDB running + COUCHDB_ADMIN_URL in frontend/.env
 * Admin credentials bypass append-only validate_doc_update on stock_ledger.
 */

import { shelterDbName } from '$lib/server/shelter-access-design';
import { couchReq, displayCouchUrl } from './seed/couch';
import { prefixRangeEnd } from './t31-seed-support';
import { deleteDocs, listDatabases } from './unseed';

/** Doc `_id` prefixes wiped from each targeted shelter_* database. */
export const STOCK_DOC_PREFIXES = [
	'stock_ledger:',
	'stock_threshold_override:',
	'stock_lot_reservation:',
	'item_master:'
] as const;

/**
 * Doc `_id` prefixes wiped from the central `catalog` database.
 * `item:` = legacy supply_item (`type: 'supply_item'`); `item_master:` = catalog masters.
 */
export const CATALOG_ITEM_PREFIXES = ['item_master:', 'item:'] as const;

export const CATALOG_DB = 'catalog';

const SHELTER_DB_PREFIX = 'shelter_';
const BULK_CHUNK = 500;

export type CouchReq = typeof couchReq;

export function parseShelterFlag(argv: string[]): string | null {
	const eq = argv.find((a) => a.startsWith('--shelter='));
	if (eq) {
		const value = eq.slice('--shelter='.length).trim();
		return value.length > 0 ? value : null;
	}
	const idx = argv.indexOf('--shelter');
	if (idx >= 0) {
		const next = argv[idx + 1];
		if (next && !next.startsWith('--')) return next.trim();
	}
	return null;
}

/** Resolve CLI shelter token → one DB name, or `null` when token means all shelters. */
export function resolveShelterTarget(shelter: string): { all: true } | { all: false; db: string } {
	const token = shelter.trim();
	if (!token) throw new Error('Empty --shelter value');
	if (token.toLowerCase() === 'all') return { all: true };

	if (token.toLowerCase().startsWith(SHELTER_DB_PREFIX)) {
		return { all: false, db: token.toLowerCase() };
	}

	return { all: false, db: shelterDbName(token) };
}

export async function listShelterDatabases(req: CouchReq = couchReq): Promise<string[]> {
	const dbs = await listDatabases(req);
	return dbs.filter((db) => db.startsWith(SHELTER_DB_PREFIX)).sort();
}

export async function findDocsByPrefix(
	db: string,
	prefix: string,
	req: CouchReq = couchReq
): Promise<Array<{ id: string; rev: string }>> {
	const startkey = encodeURIComponent(JSON.stringify(prefix));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd(prefix)));
	const { status, data } = await req(
		'GET',
		`/${encodeURIComponent(db)}/_all_docs?startkey=${startkey}&endkey=${endkey}`
	);
	if (status === 404) return [];
	if (status !== 200) {
		throw new Error(`Cannot list "${prefix}" docs in "${db}" (HTTP ${status})`);
	}
	const rows = (data as { rows?: Array<{ id?: string; value?: { rev?: string } }> })?.rows ?? [];
	return rows
		.filter((r): r is { id: string; value: { rev: string } } =>
			Boolean(r.id && r.id.startsWith(prefix) && r.value?.rev)
		)
		.map((r) => ({ id: r.id, rev: r.value.rev }));
}

/**
 * Like {@link findDocsByPrefix}, but keeps only rows whose doc `type` matches.
 * Used for `item:` so we never delete non-supply docs that share the prefix.
 */
export async function findDocsByPrefixAndType(
	db: string,
	prefix: string,
	docType: string,
	req: CouchReq = couchReq
): Promise<Array<{ id: string; rev: string }>> {
	const startkey = encodeURIComponent(JSON.stringify(prefix));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd(prefix)));
	const { status, data } = await req(
		'GET',
		`/${encodeURIComponent(db)}/_all_docs?startkey=${startkey}&endkey=${endkey}&include_docs=true`
	);
	if (status === 404) return [];
	if (status !== 200) {
		throw new Error(`Cannot list "${prefix}" docs in "${db}" (HTTP ${status})`);
	}
	const rows =
		(
			data as {
				rows?: Array<{
					id?: string;
					value?: { rev?: string };
					doc?: { _rev?: string; type?: string };
				}>;
			}
		)?.rows ?? [];
	return rows
		.filter(
			(r): r is { id: string; value?: { rev: string }; doc: { _rev: string; type: string } } =>
				Boolean(
					r.id &&
					r.id.startsWith(prefix) &&
					r.doc?.type === docType &&
					(r.value?.rev || r.doc?._rev)
				)
		)
		.map((r) => ({ id: r.id, rev: r.value?.rev ?? r.doc._rev }));
}

export async function findStockDocsInDb(
	db: string,
	req: CouchReq = couchReq
): Promise<Array<{ id: string; rev: string }>> {
	const out: Array<{ id: string; rev: string }> = [];
	for (const prefix of STOCK_DOC_PREFIXES) {
		out.push(...(await findDocsByPrefix(db, prefix, req)));
	}
	return out;
}

export async function findCatalogItemDocs(
	req: CouchReq = couchReq
): Promise<Array<{ id: string; rev: string }>> {
	const masters = await findDocsByPrefix(CATALOG_DB, 'item_master:', req);
	const supplyItems = await findDocsByPrefixAndType(CATALOG_DB, 'item:', 'supply_item', req);
	return [...masters, ...supplyItems];
}

async function deleteDocsChunked(
	db: string,
	docs: Array<{ id: string; rev: string }>,
	req: CouchReq
): Promise<void> {
	for (let i = 0; i < docs.length; i += BULK_CHUNK) {
		await deleteDocs(db, docs.slice(i, i + BULK_CHUNK), req);
	}
}

export async function unseedStock(options: {
	shelter: string;
	confirm?: boolean;
	req?: CouchReq;
	displayUrl?: string;
}): Promise<{ dbs: string[]; docsByDb: Record<string, string[]> }> {
	const req = options.req ?? couchReq;
	const confirm = options.confirm ?? false;
	const url = options.displayUrl ?? displayCouchUrl();
	const target = resolveShelterTarget(options.shelter);

	const shelterDbs = await listShelterDatabases(req);
	const dbs = target.all
		? shelterDbs
		: shelterDbs.includes(target.db)
			? [target.db]
			: (() => {
					throw new Error(
						`Shelter database "${target.db}" not found. Available: ${shelterDbs.join(', ') || '(none)'}`
					);
				})();

	const allDbs = await listDatabases(req);
	const catalogExists = allDbs.includes(CATALOG_DB);

	console.log(`\nUnseed STOCK/SUPPLY → ${url}`);
	console.log(`Shelter prefixes: ${STOCK_DOC_PREFIXES.join(', ')}`);
	console.log(
		`Catalog (${CATALOG_DB}): ${CATALOG_ITEM_PREFIXES.join(', ')} (item: filtered to type=supply_item)`
	);
	console.log(`Shelters: ${target.all ? 'all' : dbs[0]}`);

	const foundByDb: Record<string, Array<{ id: string; rev: string }>> = {};
	const docsByDb: Record<string, string[]> = {};
	let total = 0;

	for (const db of dbs) {
		const docs = await findStockDocsInDb(db, req);
		foundByDb[db] = docs;
		docsByDb[db] = docs.map((d) => d.id);
		total += docs.length;
		console.log(`\n${db}: ${docs.length} document(s)`);
		for (const doc of docs) console.log(`  - ${doc.id}`);
	}

	if (catalogExists) {
		const catalogDocs = await findCatalogItemDocs(req);
		foundByDb[CATALOG_DB] = catalogDocs;
		docsByDb[CATALOG_DB] = catalogDocs.map((d) => d.id);
		total += catalogDocs.length;
		console.log(`\n${CATALOG_DB}: ${catalogDocs.length} document(s)`);
		for (const doc of catalogDocs) console.log(`  - ${doc.id}`);
	} else {
		console.log(`\n${CATALOG_DB}: (database not found — skipped)`);
	}

	const resultDbs = catalogExists ? [...dbs, CATALOG_DB] : dbs;

	if (dbs.length === 0 && !catalogExists) {
		console.log('\nNo shelter_* or catalog databases found.\n');
		return { dbs: [], docsByDb: {} };
	}

	if (total === 0) {
		console.log('\nNothing to delete.\n');
		return { dbs: resultDbs, docsByDb };
	}

	if (!confirm) {
		console.log(`\nDry run — ${total} doc(s). Re-run with --confirm to delete.\n`);
		return { dbs: resultDbs, docsByDb };
	}

	console.log('');
	for (const db of resultDbs) {
		const docs = foundByDb[db] ?? [];
		if (docs.length === 0) continue;
		await deleteDocsChunked(db, docs, req);
		console.log(`  ✓ ${db}: deleted ${docs.length} document(s)`);
	}

	console.log('\nDone.\n');
	return { dbs: resultDbs, docsByDb };
}

export async function main(argv: string[] = process.argv): Promise<void> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(`
Usage:
  pnpm unseed:stock --shelter=SH001              (dry-run one shelter + catalog items)
  pnpm unseed:stock --shelter=SH001 --confirm    (delete)
  pnpm unseed:stock --shelter=all --confirm      (every shelter_* + catalog items)

Shelter deletes: ${STOCK_DOC_PREFIXES.join(', ')}
Catalog deletes: item_master:*, item:* (type=supply_item only)
Does not delete: item_category, recipe, unit_of_measure
`);
		return;
	}

	const shelter = parseShelterFlag(argv);
	if (!shelter) {
		console.error('✗ --shelter is required (e.g. --shelter=SH001 or --shelter=all)');
		process.exit(1);
	}

	const confirm = argv.includes('--confirm');
	await unseedStock({ shelter, confirm });
}

if (process.argv[1]?.endsWith('unseed-stock.ts')) {
	main().catch((err: unknown) => {
		console.error('\nUnseed stock failed:', err);
		process.exit(1);
	});
}
