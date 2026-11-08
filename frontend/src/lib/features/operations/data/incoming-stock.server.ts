import { adminRaw } from '$lib/server/couch-admin';
import { fetchDocs } from '$lib/server/donation-docs';
import { listShelterCodes, shelterDb } from '$lib/server/donation-intake';
import { CATALOG_DB } from '$lib/features/supply/server';
import type { PackagingSource } from '$lib/features/catalog/server';
import {
	deriveDonationIncoming,
	deriveTransferIncoming,
	type IncomingCatalog,
	type IncomingDonationDoc,
	type IncomingStockResult,
	type IncomingTransferDoc
} from '../domain/incoming-stock';

/**
 * Server-only read model behind `GET /api/back-office/stock/incoming` (#1153).
 *
 * Reads donations from the shelter DB(s) and shipped transfers from `central_ops`, then runs the
 * pure derivation in `domain/incoming-stock.ts`. Nothing here is persisted.
 */

/** Page size of the `central_ops` transfer `_find`; the loop below reads every page (FR-11). */
export const INCOMING_TRANSFER_PAGE_SIZE = 200;
/** Safety bound on the transfer bookmark loop (200 x 500 = 100k shipped transfers). */
const MAX_TRANSFER_PAGES = 500;

/** Only what the derivation needs — driver name / plate never leave CouchDB. */
const TRANSFER_FIELDS = ['_id', 'type', 'status', 'to_shelter', 'items', 'timeline'];

type CatalogDoc = PackagingSource & { _id: string };

function toCatalog(docs: readonly CatalogDoc[]): Map<string, PackagingSource> {
	const map = new Map<string, PackagingSource>();
	for (const d of docs) {
		if (d?._id) map.set(d._id, d);
	}
	return map;
}

/** Shared catalog masters (`item_master:` + legacy `item:`). Shelter-own masters overlay it. */
async function readCatalog(): Promise<Map<string, PackagingSource>> {
	const [masters, supply] = await Promise.all([
		fetchDocs<CatalogDoc>(CATALOG_DB, 'item_master:'),
		fetchDocs<CatalogDoc>(CATALOG_DB, 'item:')
	]);
	return toCatalog([...supply, ...masters]);
}

async function readShelterCatalog(shared: IncomingCatalog, code: string): Promise<IncomingCatalog> {
	const own = await fetchDocs<CatalogDoc>(shelterDb(code), 'item_master:');
	if (own.length === 0) return shared;
	return new Map([...shared, ...toCatalog(own)]);
}

/**
 * Every `shipped` transfer addressed to `toShelter` — or, with `null` (SA, all shelters), every
 * `shipped` transfer. Walks the Mango bookmark to the end: no 50-row cap.
 *
 * Single shelter: `(type, to_shelter, created_at)` index — `created_at: {$gt: null}` is only
 * there so the selector covers all three indexed fields. All shelters: `(type, status)` index.
 */
export async function readShippedTransfers(
	toShelter: string | null
): Promise<IncomingTransferDoc[]> {
	const selector: Record<string, unknown> = toShelter
		? {
				type: 'stock_transfer',
				to_shelter: toShelter,
				created_at: { $gt: null },
				status: 'shipped'
			}
		: { type: 'stock_transfer', status: 'shipped' };

	const docs: IncomingTransferDoc[] = [];
	let bookmark: string | undefined;
	for (let page = 0; page < MAX_TRANSFER_PAGES; page++) {
		const res = await adminRaw('/central_ops/_find', 'POST', {
			selector,
			fields: TRANSFER_FIELDS,
			limit: INCOMING_TRANSFER_PAGE_SIZE,
			...(bookmark ? { bookmark } : {})
		});
		if (res.status >= 400) {
			throw Object.assign(new Error('Could not read transfers'), { status: 502 });
		}
		const body = (res.data as { docs?: IncomingTransferDoc[]; bookmark?: string } | null) ?? {};
		const batch = body.docs ?? [];
		docs.push(...batch);
		if (batch.length < INCOMING_TRANSFER_PAGE_SIZE || !body.bookmark) break;
		bookmark = body.bookmark;
	}
	return docs.filter((d) => d?.status === 'shipped' && (!toShelter || d.to_shelter === toShelter));
}

/**
 * Incoming rows + unmatched lines for one shelter (`shelterCode`) or every shelter (`null`).
 * Rows hold ids, quantities, dates and shelter codes only — no donor identity.
 */
export async function readIncomingStock(
	shelterCode: string | null,
	now: Date = new Date()
): Promise<IncomingStockResult> {
	const codes = shelterCode ? [shelterCode] : await listShelterCodes();
	const shared = await readCatalog();

	const result: IncomingStockResult = { rows: [], unmatched: [] };
	for (const code of codes) {
		const catalog = await readShelterCatalog(shared, code);
		const donations = await fetchDocs<IncomingDonationDoc & { type?: string }>(
			shelterDb(code),
			'donation:'
		);
		for (const d of donations) {
			if (d?.type !== 'donation') continue;
			const r = deriveDonationIncoming(d, code, catalog, now);
			result.rows.push(...r.rows);
			result.unmatched.push(...r.unmatched);
		}
	}

	for (const t of await readShippedTransfers(shelterCode)) {
		result.rows.push(...deriveTransferIncoming(t));
	}
	return result;
}
