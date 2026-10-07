// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplyItem } from '$lib/features/supply';

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
				const rev = `${(docs.get(doc._id)?._rev ? parseInt(docs.get(doc._id)!._rev!, 10) : 0) + 1}-t`;
				const saved = { ...clone(doc), _rev: rev };
				docs.set(doc._id, saved);
				return clone(saved);
			},
			async allByType(type: string, guard: (d: unknown) => boolean): Promise<unknown[]> {
				return [...docs.values()]
					.filter((d) => d._id.startsWith(`${type}:`) && guard(d))
					.map(clone);
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

	it('reports a transition error when the donation has meanwhile expired', async () => {
		// the TTL job lapsed the booking while staff were counting
		docs.set(donation._id, { ...clone(donation), status: 'expired' } as unknown as Doc);

		const result = await repo.receiveDonationBatch(donation, fullCount(), ctx);

		expect(result.rowsComplete).toBe(true);
		expect(result.received).toBe(false);
		expect(result.transitionError).toContain('Cannot receive');
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
