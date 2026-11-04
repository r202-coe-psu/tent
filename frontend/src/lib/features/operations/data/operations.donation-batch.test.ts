// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplyItem } from '$lib/features/supply';
import { ConflictError } from '$lib/utils/errors';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

const mockGetItem = vi.fn<(itemId: string) => Promise<SupplyItem | null>>();
vi.mock('$lib/features/supply', () => ({
	supplyRepository: () => ({ getItem: mockGetItem })
}));

// ---- in-memory CouchDB: one map of docs, one hook per failure the tests inject -----------

type Doc = { _id: string; _rev?: string } & Record<string, unknown>;
const docs = new Map<string, Doc>();
/** `_id`s that `_bulk_docs` rejects (per-row error, the rest of the batch lands). */
const failingBulkIds = new Set<string>();
/** Throw from the bulk call itself AFTER writing the rows (a lost response). */
let loseBulkResponse = false;
/** Doc ids whose single-doc `put` fails (the donation transition). */
const failingPutIds = new Set<string>();
/** Doc ids whose single-doc `put` throws `ConflictError` (a 409, or another 4xx). */
const conflictingPutIds = new Set<string>();
/** Runs just before that `ConflictError` — whatever is on file by the time it is thrown. */
let onConflictingPut: (() => void) | null = null;
/** Runs once the bulk write lands — another screen or the donor acting mid-receipt. */
let afterBulkWrite: (() => void) | null = null;
const bulkCalls: string[][] = [];

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return {
		...actual,
		createRemoteRepository: () => ({
			async get(id: string) {
				const found = docs.get(id);
				return found ? clone(found) : null;
			},
			async put(doc: Doc) {
				if (failingPutIds.has(doc._id)) throw new Error(`write refused for ${doc._id}`);
				if (conflictingPutIds.has(doc._id)) {
					onConflictingPut?.();
					throw new ConflictError();
				}
				const rev = `${(docs.get(doc._id)?._rev ? parseInt(docs.get(doc._id)!._rev!, 10) : 0) + 1}-t`;
				const saved = { ...clone(doc), _rev: rev };
				docs.set(doc._id, saved);
				return clone(saved);
			},
			async allByType(type: string, guard: (d: unknown) => boolean): Promise<unknown[]> {
				return [...docs.values()]
					.filter((d) => d._id.startsWith(`${type}:`) && guard(d))
					.map(clone);
			},
			// Mango selector over the in-memory docs: equality, plus `{ $gt: null }` = present.
			async find(query: { selector: Record<string, unknown>; limit?: number }) {
				const hits = [...docs.values()].filter((d) =>
					Object.entries(query.selector).every(([key, value]) => {
						const actual = (d as unknown as Record<string, unknown>)[key];
						if (value && typeof value === 'object' && '$gt' in value) {
							return actual !== undefined && actual !== null;
						}
						return actual === value;
					})
				);
				return hits.slice(0, query.limit ?? hits.length).map(clone);
			}
		})
	};
});

vi.mock('$lib/db/couch-db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/couch-db')>();
	return {
		...actual,
		getDoc: async (_db: string, id: string) => (docs.has(id) ? clone(docs.get(id)) : null),
		putDocStrict: async (_db: string, doc: Doc) => doc,
		bulkDocs: async () => {
			throw new Error('receiveDonationBatch must use the per-row bulk write');
		},
		bulkDocsDetailed: async (_db: string, batch: Doc[]) => {
			bulkCalls.push(batch.map((d) => d._id));
			const outcomes = batch.map((doc) => {
				if (failingBulkIds.has(doc._id)) {
					return {
						id: doc._id,
						ok: false as const,
						status: 403,
						error: 'forbidden',
						reason: 'injected row failure'
					};
				}
				if (docs.has(doc._id)) {
					// put-if-absent: the row is already there
					return {
						id: doc._id,
						ok: false as const,
						status: 409,
						error: 'conflict',
						reason: 'Document update conflict.'
					};
				}
				docs.set(doc._id, { ...clone(doc), _rev: '1-t' });
				return { id: doc._id, ok: true as const, rev: '1-t' };
			});
			afterBulkWrite?.();
			if (loseBulkResponse) throw new Error('network dropped after the write');
			return outcomes;
		}
	};
});

import { OperationsRemoteRepository } from './operations.remote';
import {
	calculateReserved,
	createWalkInDonation,
	isStockLedger,
	stockBalance,
	type Donation,
	type StockLedger
} from '../domain/operations';
import {
	deriveDonationReceiptLineId,
	donationShortfall,
	type DonationBatchLine
} from '../domain/donation-batch';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

const ITEMS = [
	{ item_id: 'item:rice', qty: '10', unit: 'kg' },
	{ item_id: 'item:water', qty: '20', unit: 'ขวด' },
	{ item_id: 'item:oil', qty: '6', unit: 'ขวด' }
];

function makeDonation(): Donation {
	return createWalkInDonation(
		{
			donor: { name: 'ผู้ใจบุญ', phone: null, phone_hash: 'hash' },
			kind: 'items',
			items: ITEMS,
			campaign_id: null,
			tracking_token_hash: 'tok'
		},
		ctx
	);
}

/** Staff counted exactly what the ticket says. */
function fullCount(): DonationBatchLine[] {
	return ITEMS.map((item, line_no) => ({ ...item, line_no }));
}

function ledgerRows(): StockLedger[] {
	return ([...docs.values()] as unknown[]).filter(isStockLedger);
}

let repo: OperationsRemoteRepository;
let donation: Donation;

beforeEach(() => {
	docs.clear();
	failingBulkIds.clear();
	failingPutIds.clear();
	conflictingPutIds.clear();
	onConflictingPut = null;
	afterBulkWrite = null;
	bulkCalls.length = 0;
	loseBulkResponse = false;
	mockGetItem.mockReset();
	mockGetItem.mockImplementation(async (id) => {
		const unit = ITEMS.find((i) => i.item_id === id)?.unit;
		return unit ? ({ unit } as SupplyItem) : null;
	});
	repo = new OperationsRemoteRepository('shelter_sh001');
	donation = makeDonation();
	docs.set(donation._id, clone(donation) as unknown as Doc);
});

const storedDonation = () => docs.get(donation._id) as unknown as Donation;

describe('receiveDonationBatch — complete receipts (CR-143 FR-B4)', () => {
	it('AC-B1: a 3-line ticket received in full writes 3 ledger rows and marks the donation received', async () => {
		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.rowsComplete).toBe(true);
		expect(result.received).toBe(true);
		expect(result.lines.map((l) => l.state)).toEqual(['saved', 'saved', 'saved']);
		expect(ledgerRows()).toHaveLength(3);
		expect(ledgerRows().every((r) => r.reason === 'donation' && r.ref_id === donation._id)).toBe(
			true
		);
		expect(storedDonation().status).toBe('received');
		expect(storedDonation().received_at).not.toBeNull();
		// FR-B4: one write for all rows
		expect(bulkCalls).toHaveLength(1);
		expect(bulkCalls[0]).toHaveLength(3);
	});

	// CR-174 AC-3 — a refusal at review is not undone at the shelf.
	it('refuses to receive a line that was refused at review, writing nothing', async () => {
		donation = {
			...donation,
			items: donation.items!.map((item, i) =>
				i === 1 ? { ...item, review_status: 'rejected' as const } : item
			)
		};
		docs.set(donation._id, clone(donation) as unknown as Doc);

		await expect(repo.receiveDonationBatch(donation, fullCount(), ctx)).rejects.toThrow(
			/ถูกปฏิเสธตอนประเมิน/
		);
		expect(ledgerRows()).toHaveLength(0);
		expect(bulkCalls).toHaveLength(0);
	});

	it('writes each row under its deterministic id (FR-B4a)', async () => {
		await repo.receiveDonationBatch(donation, fullCount(), ctx);

		const expected = await Promise.all(
			ITEMS.map((item, i) => deriveDonationReceiptLineId(donation._id, item.item_id, i))
		);
		expect(
			ledgerRows()
				.map((r) => r._id)
				.sort()
		).toEqual([...expected].sort());
	});

	it('AC-B2: received 8 of 10 reports the shortfall and releases the reserved quantity', async () => {
		const counted = fullCount();
		counted[0] = { ...counted[0], qty: '8' };
		await repo.receiveDonationBatch(donation, counted, ctx);

		expect(donationShortfall(ITEMS, counted)).toEqual([
			{ item_id: 'item:rice', declared: '10', counted: '8', short: '2' }
		]);
		// no new donation status: it is received, and nothing stays reserved
		expect(storedDonation().status).toBe('received');
		const reserved = calculateReserved([storedDonation()], ledgerRows());
		expect(reserved.get('item:rice')).toBeUndefined();
		expect(stockBalance(ledgerRows()).get('item:rice')).toBe('8');
	});

	it('AC-B3: a line counted as 0 writes no ledger row', async () => {
		const counted = fullCount();
		counted[2] = { ...counted[2], qty: '0' };
		const result = await repo.receiveDonationBatch(donation, counted, ctx);

		expect(ledgerRows()).toHaveLength(2);
		expect(ledgerRows().some((r) => r.item_id === 'item:oil')).toBe(false);
		expect(result.lines[2].state).toBe('skipped');
		expect(result.received).toBe(true);
	});

	it('accepts a line that is not on the ticket (FR-B3)', async () => {
		mockGetItem.mockImplementation(async (id) => {
			const unit = ITEMS.find((i) => i.item_id === id)?.unit ?? 'ขวด';
			return { unit } as SupplyItem;
		});
		const counted = [...fullCount(), { item_id: 'item:extra', qty: '3', unit: 'ขวด', line_no: 3 }];
		await repo.receiveDonationBatch(donation, counted, ctx);

		expect(ledgerRows()).toHaveLength(4);
		expect(ledgerRows().find((r) => r.item_id === 'item:extra')?.ref_id).toBe(donation._id);
	});

	it('refuses a receipt with nothing received instead of closing the ticket on no rows', async () => {
		const counted = fullCount().map((l) => ({ ...l, qty: '0' }));
		await expect(repo.receiveDonationBatch(donation, counted, ctx)).rejects.toThrow(
			'Nothing was received'
		);
		expect(storedDonation().status).toBe('declared');
	});
});

describe('receiveDonationBatch — bookings split across drop-off points (CR-206 FR-MP-24a)', () => {
	it('AC-19: refuses a booking whose lines name a drop-off point, keying nothing', async () => {
		donation = {
			...donation,
			items: donation.items!.map((item, i) =>
				i === 1 ? { ...item, drop_off_point_id: 'sp-med' } : item
			)
		};
		docs.set(donation._id, clone(donation) as unknown as Doc);

		await expect(repo.receiveDonationBatch(donation, fullCount(), ctx)).rejects.toThrow(
			'ใบนี้แยกส่งหลายจุด — รับที่หน้าสแกน'
		);
		expect(ledgerRows()).toHaveLength(0);
		expect(bulkCalls).toHaveLength(0);
		expect(storedDonation().status).toBe(donation.status);
	});

	it('refuses a booking a point started receiving since the page was opened', async () => {
		docs.set(donation._id, {
			...(clone(donation) as unknown as Doc),
			point_receipts: [
				{
					point_id: 'sp-gym',
					line_nos: [0],
					received_at: '2026-10-28T02:00:00.000Z',
					received_by: 'staff',
					audit_id: 'audit:X',
					ledger_ids: [],
					items: [{ line_no: 0, item_id: 'item:rice', qty: '0', unit: 'kg', rejected: true }]
				}
			]
		});

		await expect(repo.receiveDonationBatch(donation, fullCount(), ctx)).rejects.toThrow(
			/แยกส่งหลายจุด/
		);
		expect(bulkCalls).toHaveLength(0);
	});
});

describe('receiveDonationBatch — validation writes nothing (CR-143 FR-D2)', () => {
	it('rejects a perishable line without lot.expiry before any row is written', async () => {
		mockGetItem.mockImplementation(async (id) =>
			id === 'item:water'
				? ({ unit: 'ขวด', perishable: true } as SupplyItem)
				: ({ unit: ITEMS.find((i) => i.item_id === id)?.unit } as SupplyItem)
		);

		await expect(repo.receiveDonationBatch(donation, fullCount(), ctx)).rejects.toThrow(
			'requires lot.expiry'
		);
		expect(ledgerRows()).toHaveLength(0);
		expect(bulkCalls).toHaveLength(0);
		expect(storedDonation().status).toBe('declared');
	});

	it('accepts the perishable line once lot.expiry is supplied', async () => {
		mockGetItem.mockImplementation(async (id) =>
			id === 'item:water'
				? ({ unit: 'ขวด', perishable: true } as SupplyItem)
				: ({ unit: ITEMS.find((i) => i.item_id === id)?.unit } as SupplyItem)
		);
		const counted = fullCount();
		counted[1] = { ...counted[1], lot: { expiry: '2027-01-31' } };

		const result = await repo.receiveDonationBatch(donation, counted, ctx);
		expect(result.received).toBe(true);
		expect(ledgerRows().find((r) => r.item_id === 'item:water')?.lot?.expiry).toBe('2027-01-31');
	});

	it('rejects a unit that disagrees with the catalog without writing the other lines', async () => {
		const counted = fullCount();
		counted[0] = { ...counted[0], unit: 'bag' };
		await expect(repo.receiveDonationBatch(donation, counted, ctx)).rejects.toThrow(
			'Unit mismatch'
		);
		expect(ledgerRows()).toHaveLength(0);
	});

	it('rejects duplicate line numbers and lines without an item', async () => {
		const [a, b] = fullCount();
		await expect(
			repo.receiveDonationBatch(donation, [a, { ...b, line_no: a.line_no }], ctx)
		).rejects.toThrow('Duplicate line number');
		await expect(repo.receiveDonationBatch(donation, [{ ...a, item_id: '' }], ctx)).rejects.toThrow(
			'has no item'
		);
	});
});

describe('receiveDonationBatch — partial failure and retry (CR-143 FR-B7 / FR-B8)', () => {
	async function failLine(lineNo: number): Promise<string> {
		const id = await deriveDonationReceiptLineId(donation._id, ITEMS[lineNo].item_id, lineNo);
		failingBulkIds.add(id);
		return id;
	}

	it('AC-B4: 2 of 3 rows saved leaves the donation open, names the failed line, and a retry completes it', async () => {
		const failedId = await failLine(2);

		const first = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(first.rowsComplete).toBe(false);
		expect(first.received).toBe(false);
		expect(first.lines.map((l) => l.state)).toEqual(['saved', 'saved', 'failed']);
		expect(first.lines[2].error).toContain('injected row failure');
		expect(first.lines[2].ledger_id).toBe(failedId);
		expect(ledgerRows()).toHaveLength(2);
		// the donation did not move until every row is in
		expect(storedDonation().status).toBe('declared');

		failingBulkIds.clear();
		const retry = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(retry.received).toBe(true);
		expect(retry.lines.map((l) => l.state)).toEqual(['saved', 'saved', 'saved']);
		expect(ledgerRows()).toHaveLength(3);
		expect(new Set(ledgerRows().map((r) => r._id)).size).toBe(3);
		expect(storedDonation().status).toBe('received');
	});

	// Full-branch review W1 — row ids carry the item, so a line matched to another item on
	// the retry gets a new id. Without the ledger check the goods went in twice (4 rows for
	// a 3-line booking) and the booking closed.
	it('refuses a retry that matched an already keyed line to another item', async () => {
		await failLine(2);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		expect(ledgerRows()).toHaveLength(2);
		failingBulkIds.clear();

		const rematched = fullCount().map((line, i) =>
			i === 0 ? { ...line, item_id: 'item:water', unit: 'ขวด' } : line
		);
		await expect(repo.receiveDonationBatch(donation, rematched, ctx)).rejects.toThrow(
			/ไม่ตรงกับรายการที่นับรอบนี้/
		);

		expect(ledgerRows()).toHaveLength(2);
		expect(storedDonation().status).toBe('declared');
	});

	it('refuses a second screen that keyed a line as another item first', async () => {
		const otherScreen = fullCount().map((line, i) =>
			i === 0 ? { ...line, item_id: 'item:oil', unit: 'ขวด' } : line
		);
		// The other screen's write landed, but its close did not: the booking is still open
		// and its `_rev` unchanged, so only the ledger tells the two counts apart.
		failingPutIds.add(donation._id);
		await repo.receiveDonationBatch(donation, otherScreen, ctx);
		failingPutIds.clear();
		const rowsBefore = ledgerRows().length;

		await expect(repo.receiveDonationBatch(donation, fullCount(), ctx)).rejects.toThrow(
			/ไม่ตรงกับรายการที่นับรอบนี้/
		);
		expect(ledgerRows()).toHaveLength(rowsBefore);
	});

	it('retries only the failed row (FR-B7)', async () => {
		await failLine(1);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		bulkCalls.length = 0;
		failingBulkIds.clear();

		await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(bulkCalls).toHaveLength(1);
		expect(bulkCalls[0]).toEqual([
			await deriveDonationReceiptLineId(donation._id, 'item:water', 1)
		]);
	});

	it('AC-B5: retrying twice more with the same data creates no extra rows', async () => {
		await failLine(2);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		failingBulkIds.clear();
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		const afterRetry = ledgerRows()
			.map((r) => r._id)
			.sort();
		bulkCalls.length = 0;

		const again = await repo.receiveDonationBatch(donation, fullCount(), ctx);
		const andAgain = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(
			ledgerRows()
				.map((r) => r._id)
				.sort()
		).toEqual(afterRetry);
		expect(ledgerRows()).toHaveLength(3);
		expect(again.received && andAgain.received).toBe(true);
		// nothing was sent to the ledger at all
		expect(bulkCalls).toHaveLength(0);
	});

	it('treats a 409 on a deterministic id as already recorded, not as a failure', async () => {
		// the row exists from a previous attempt whose response never reached the client
		const first = await repo.receiveDonationBatch(donation, fullCount(), ctx);
		expect(first.received).toBe(true);
		const rowId = first.lines[0].ledger_id!;
		const kept = clone(docs.get(rowId)!);
		docs.clear();
		docs.set(donation._id, clone(donation) as unknown as Doc);
		docs.set(rowId, kept);

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.lines.map((l) => l.state)).toEqual(['saved', 'saved', 'saved']);
		expect(ledgerRows()).toHaveLength(3);
	});

	it('reads the ledger back when the bulk response is lost, so a row that did land is not retried as failed', async () => {
		loseBulkResponse = true;
		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(ledgerRows()).toHaveLength(3);
		expect(result.lines.map((l) => l.state)).toEqual(['saved', 'saved', 'saved']);
		expect(result.received).toBe(true);
	});

	it('FR-B8: rows complete but the transition failed — the retry only runs the transition', async () => {
		failingPutIds.add(donation._id);
		const first = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(first.rowsComplete).toBe(true);
		expect(first.received).toBe(false);
		expect(first.transitionError).toContain('write refused');
		expect(ledgerRows()).toHaveLength(3);
		expect(storedDonation().status).toBe('declared');
		bulkCalls.length = 0;

		failingPutIds.clear();
		const retry = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(retry.received).toBe(true);
		expect(retry.transitionError).toBeUndefined();
		expect(bulkCalls).toHaveLength(0);
		expect(ledgerRows()).toHaveLength(3);
		expect(storedDonation().status).toBe('received');
	});

	// Another screen received the booking; this one still holds the copy from before and
	// counted a line differently — keying it would put the goods in stock twice.
	it('refuses a second screen keying new rows into a booking already received', async () => {
		const opened = clone(donation);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		const rowsBefore = ledgerRows().length;
		const summaryBefore = storedDonation().received_summary;

		const differently = fullCount().map((line, i) =>
			i === 0 ? { ...line, item_id: 'item:oil', unit: 'ขวด' } : line
		);
		await expect(repo.receiveDonationBatch(opened, differently, ctx)).rejects.toThrow(
			/รับเข้าคลังไปแล้วจากอีกหน้าจอ/
		);
		expect(ledgerRows()).toHaveLength(rowsBefore);
		expect(storedDonation().received_summary).toEqual(summaryBefore);
	});

	it('still lets the same count through when the first answer was lost (FR-B8)', async () => {
		const opened = clone(donation);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);

		const again = await repo.receiveDonationBatch(opened, fullCount(), ctx);

		expect(again.received).toBe(true);
		expect(ledgerRows()).toHaveLength(3);
	});

	it('does not clobber a donation that was already received by an earlier attempt', async () => {
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		const receivedAt = storedDonation().received_at;

		const again = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(again.received).toBe(true);
		expect(storedDonation().received_at).toBe(receivedAt);
	});

	it('refuses to re-send an already recorded line with a different quantity', async () => {
		await failLine(2);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		failingBulkIds.clear();

		const edited = fullCount();
		edited[0] = { ...edited[0], qty: '7' };
		await expect(repo.receiveDonationBatch(donation, edited, ctx)).rejects.toThrow(
			'already recorded'
		);
		expect(ledgerRows()).toHaveLength(2);
	});

	// The TTL job lapsed the booking while staff were counting. Its quota is already back
	// with other donors: keying the goods first and failing the transition after left them
	// in stock against a booking that no longer held anything.
	it('refuses a booking that expired while it was being counted, keying nothing', async () => {
		docs.set(donation._id, { ...clone(donation), status: 'expired' } as unknown as Doc);

		await expect(repo.receiveDonationBatch(donation, fullCount(), ctx)).rejects.toThrow(
			/ปิดไปแล้ว/
		);
		expect(ledgerRows()).toHaveLength(0);
		expect(bulkCalls).toHaveLength(0);
	});

	// CR-174 — staff refused a line, or the donor edited / cancelled the booking, after the
	// form was opened: the counted copy is stale.
	it('refuses a count made against an older copy of the booking, keying nothing', async () => {
		docs.set(donation._id, {
			...clone(donation),
			_rev: '9-changed',
			items: donation.items!.map((item, i) =>
				i === 1 ? { ...item, review_status: 'rejected' as const } : item
			)
		} as unknown as Doc);

		await expect(
			repo.receiveDonationBatch({ ...donation, _rev: '1-opened' }, fullCount(), ctx)
		).rejects.toThrow(/ถูกแก้หลังจากเปิดหน้าไว้/);
		expect(ledgerRows()).toHaveLength(0);
	});

	// An interrupted first attempt keyed one line; the booking then changed. Telling staff
	// "nothing is in stock" would invite counting that line again.
	it('says goods are already in stock when an earlier attempt keyed some', async () => {
		await failLine(2);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		const rowsBefore = ledgerRows().length;
		docs.set(donation._id, { ...storedDonation(), _rev: '9-changed' } as unknown as Doc);

		await expect(
			repo.receiveDonationBatch({ ...donation, _rev: '1-opened' }, fullCount(), ctx)
		).rejects.toThrow(/มีของบางรายการของใบนี้เข้าคลังไปแล้ว/);
		expect(ledgerRows()).toHaveLength(rowsBefore);
	});

	it('refuses a booking the donor cancelled while it was being counted', async () => {
		docs.set(donation._id, { ...clone(donation), status: 'cancelled' } as unknown as Doc);

		await expect(repo.receiveDonationBatch(donation, fullCount(), ctx)).rejects.toThrow(
			/ปิดไปแล้ว/
		);
		expect(ledgerRows()).toHaveLength(0);
	});

	// S-R4-1 — the booking changed after it was read but before it was closed. The rows are
	// in; closing it from this count would write over the change.
	it('leaves the booking open when a line is refused while the rows are keyed', async () => {
		afterBulkWrite = () => {
			const onFile = storedDonation();
			docs.set(donation._id, {
				...clone(onFile),
				_rev: '2-refused',
				items: onFile.items!.map((item, i) =>
					i === 1 ? { ...item, review_status: 'rejected' as const } : item
				)
			} as unknown as Doc);
		};

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.rowsComplete).toBe(true);
		expect(result.received).toBe(false);
		expect(result.transitionError).toMatch(/ถูกแก้ระหว่างบันทึกเข้าคลัง/);
		expect(result.transitionBlocked).toBe(true);
		expect(storedDonation().status).toBe('declared');
		expect(storedDonation().items![1].review_status).toBe('rejected');
	});

	it('still closes the booking when only its logistics changed meanwhile', async () => {
		afterBulkWrite = () => {
			docs.set(donation._id, {
				...clone(storedDonation()),
				_rev: '2-courier',
				logistics: { courier_tracking_no: 'TH123' }
			} as unknown as Doc);
		};

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.received).toBe(true);
		expect(result.transitionBlocked).toBeUndefined();
		expect(storedDonation().status).toBe('received');
		expect(storedDonation().logistics).toEqual({ courier_tracking_no: 'TH123' });
	});

	it('reports a write that lands between the check and the close the same way', async () => {
		conflictingPutIds.add(donation._id);
		onConflictingPut = () => {
			conflictingPutIds.delete(donation._id);
			const onFile = storedDonation();
			docs.set(donation._id, {
				...clone(onFile),
				_rev: '2-refused',
				items: onFile.items!.map((item, i) =>
					i === 1 ? { ...item, review_status: 'rejected' as const } : item
				)
			} as unknown as Doc);
		};

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.received).toBe(false);
		expect(result.transitionError).toMatch(/ถูกแก้ระหว่างบันทึกเข้าคลัง/);
		expect(result.transitionBlocked).toBe(true);
		expect(storedDonation().status).toBe('declared');
	});

	// S-R14-1 — the same race, but only the courier number moved: nothing counted against
	// changed, so the close is made again over the new `_rev`.
	it('closes over a courier number written between the check and the close', async () => {
		conflictingPutIds.add(donation._id);
		onConflictingPut = () => {
			conflictingPutIds.delete(donation._id);
			docs.set(donation._id, {
				...clone(storedDonation()),
				_rev: '2-courier',
				logistics: { courier_tracking_no: 'TH123' }
			} as unknown as Doc);
		};

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.received).toBe(true);
		expect(result.transitionBlocked).toBeUndefined();
		expect(storedDonation().status).toBe('received');
		expect(storedDonation().logistics).toEqual({ courier_tracking_no: 'TH123' });
	});

	it('leaves a booking that keeps moving for someone to check', async () => {
		conflictingPutIds.add(donation._id);
		let edits = 0;
		onConflictingPut = () => {
			edits += 1;
			docs.set(donation._id, { ...clone(storedDonation()), _rev: `${edits + 1}-edited` } as Doc);
		};

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(edits).toBe(3);
		expect(result.received).toBe(false);
		expect(result.transitionBlocked).toBe(true);
		expect(storedDonation().status).toBe('declared');
	});

	// S-R15-1 — the last try's close lands but its answer is lost: the booking on file is
	// received, so the count is too, however many tries it took.
	it('reports the booking received when the last try landed but its answer was lost', async () => {
		const put = repo['repo'].put.bind(repo['repo']);
		let tries = 0;
		vi.spyOn(repo['repo'], 'put').mockImplementation(async (doc) => {
			tries += 1;
			if (tries < 3) {
				docs.set(donation._id, {
					...clone(storedDonation()),
					_rev: `${tries + 1}-courier`
				} as Doc);
			} else {
				await put(doc);
			}
			throw new ConflictError();
		});

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(tries).toBe(3);
		expect(result.received).toBe(true);
		expect(result.transitionBlocked).toBeUndefined();
		expect(storedDonation().status).toBe('received');
	});

	// S-R13-1 — `ConflictError` also carries CouchDB's other 4xx answers. With the booking
	// unchanged on file nobody wrote it in between: the real reason shows and a retry may work.
	it('keeps the retry open when the close is refused but nobody changed the booking', async () => {
		conflictingPutIds.add(donation._id);

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.received).toBe(false);
		expect(result.transitionBlocked).toBeUndefined();
		expect(result.transitionError).toBe('Document conflict');
	});

	it('reports the booking received when the close landed but its answer was lost', async () => {
		// The PUT lands; the retry inside `putDoc` then answers 409 against the new rev.
		const put = repo['repo'].put.bind(repo['repo']);
		vi.spyOn(repo['repo'], 'put').mockImplementationOnce(async (doc) => {
			await put(doc);
			throw new ConflictError();
		});

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.received).toBe(true);
		expect(result.transitionError).toBeUndefined();
		expect(storedDonation().status).toBe('received');
	});

	// S-R5-2 — a booking closed before its rows were keyed reads `received` on both screens,
	// so neither `_rev` nor `receivedElsewhere` tells them apart; the ledger does.
	describe('a booking received before its rows were keyed', () => {
		beforeEach(() => {
			docs.set(donation._id, { ...clone(donation), status: 'received' } as unknown as Doc);
		});
		const openedReceived = () => ({ ...clone(donation), status: 'received' as const });

		it('refuses a second screen that matched a line differently', async () => {
			const first = openedReceived();
			const second = openedReceived();
			await repo.receiveDonationBatch(first, fullCount(), ctx);
			const rowsBefore = ledgerRows().length;

			const differently = fullCount().map((line, i) =>
				i === 0 ? { ...line, item_id: 'item:oil', unit: 'ขวด' } : line
			);
			await expect(repo.receiveDonationBatch(second, differently, ctx)).rejects.toThrow(
				/ไม่ตรงกับรายการที่นับรอบนี้/
			);
			expect(ledgerRows()).toHaveLength(rowsBefore);
		});

		it('still lets the same count through again', async () => {
			await repo.receiveDonationBatch(openedReceived(), fullCount(), ctx);

			const again = await repo.receiveDonationBatch(openedReceived(), fullCount(), ctx);

			expect(again.received).toBe(true);
			expect(ledgerRows()).toHaveLength(3);
		});

		// The ledger check runs here (one row is still to write) and finds only this count's
		// rows, so the FR-B7 retry of an interrupted receipt goes through.
		it('lets the same count finish rows an interrupted receipt left out', async () => {
			failingBulkIds.add(await deriveDonationReceiptLineId(donation._id, 'item:oil', 2));
			const first = await repo.receiveDonationBatch(openedReceived(), fullCount(), ctx);
			expect(first.rowsComplete).toBe(false);
			expect(ledgerRows()).toHaveLength(2);
			failingBulkIds.clear();

			const again = await repo.receiveDonationBatch(openedReceived(), fullCount(), ctx);

			expect(again.received).toBe(true);
			expect(ledgerRows()).toHaveLength(3);
		});
	});
});

describe('receiveDonationBatch — lines refused at review (CR-172 FR-13, CR-174 AC-3)', () => {
	function refuseLine(index: number) {
		donation = {
			...donation,
			items: donation.items!.map((item, i) =>
				i === index
					? {
							...item,
							review_status: 'rejected' as const,
							review_reason: 'หมดอายุ',
							review_reason_code: 'expired'
						}
					: item
			)
		};
		docs.set(donation._id, clone(donation) as unknown as Doc);
	}

	it('compares a typed-in line under the item staff matched it to', async () => {
		donation = {
			...donation,
			items: donation.items!.map((item, i) =>
				i === 0 ? { free_text: 'ของที่ผู้บริจาคพิมพ์เอง', qty: item.qty, unit: item.unit } : item
			)
		};
		docs.set(donation._id, clone(donation) as unknown as Doc);

		await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(storedDonation().received_summary?.shortfalls).toEqual([]);
	});

	it('records a refused line as not accepted, not as a shortfall', async () => {
		refuseLine(1);
		const counted = fullCount().map((line, i) => (i === 1 ? { ...line, qty: '0' } : line));

		const result = await repo.receiveDonationBatch(donation, counted, ctx);

		expect(result.received).toBe(true);
		expect(ledgerRows()).toHaveLength(2);
		const summary = storedDonation().received_summary!;
		expect(summary.shortfalls).toEqual([]);
		expect(summary.items?.[1]).toMatchObject({
			qty: '0',
			rejected: true,
			reject_reason: 'หมดอายุ',
			reject_reason_code: 'expired'
		});
		expect(summary.items?.[0]).not.toHaveProperty('rejected');
		// schema.md §2.3: every line checked, the refused one included — as the scan route.
		expect(summary.total_items).toBe(3);
	});
});

describe('receiveDonationBatch — reserved and on-hand while pending (CR-143 FR-B9)', () => {
	it('AC-B6: with 2 of 3 rows saved, a recorded item is counted once across on-hand + reserved', async () => {
		const failedId = await deriveDonationReceiptLineId(donation._id, 'item:oil', 2);
		failingBulkIds.add(failedId);
		await repo.receiveDonationBatch(donation, fullCount(), ctx);

		const ledger = ledgerRows();
		const onHand = stockBalance(ledger);
		const reserved = calculateReserved([storedDonation()], ledger);
		const covered = (id: string) => Number(onHand.get(id) ?? '0') + Number(reserved.get(id) ?? '0');

		expect(storedDonation().status).toBe('declared');
		// recorded items: on-hand carries them, reserved no longer does
		expect(onHand.get('item:rice')).toBe('10');
		expect(reserved.get('item:rice')).toBeUndefined();
		expect(onHand.get('item:water')).toBe('20');
		expect(reserved.get('item:water')).toBeUndefined();
		// the failed item is still owed
		expect(reserved.get('item:oil')).toBe('6');
		// and nothing is covered twice
		expect(covered('item:rice')).toBe(10);
		expect(covered('item:water')).toBe(20);
		expect(covered('item:oil')).toBe(6);
	});

	it('AC-B6: the same holds once the retry lands — everything released, on-hand unchanged', async () => {
		failingBulkIds.add(await deriveDonationReceiptLineId(donation._id, 'item:oil', 2));
		await repo.receiveDonationBatch(donation, fullCount(), ctx);
		failingBulkIds.clear();
		await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(calculateReserved([storedDonation()], ledgerRows()).size).toBe(0);
		expect(stockBalance(ledgerRows()).get('item:oil')).toBe('6');
	});
});
