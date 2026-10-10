import { describe, expect, it } from 'vitest';
import { deriveDeterministicLedgerId, type StockLedger } from '$lib/features/operations';
import { resolveDispatchedLotExpiry, type LedgerEntryReader } from './lot-expiry';

const TICKET = 'requisition_ticket:01JTEST00000000000000000001';
const ITEM = 'item_master:meal';
const LOT_ID = 'stock_ledger:01JLOT0000000000000000000001';
const EXPIRY = '2026-10-10T16:00:00.000Z';

function reader(rows: Partial<StockLedger>[]): LedgerEntryReader & { reads: string[] } {
	const byId = new Map(rows.map((row) => [row._id, row as StockLedger]));
	const reads: string[] = [];
	return {
		reads,
		async getLedgerEntry(id: string) {
			reads.push(id);
			return byId.get(id) ?? null;
		}
	};
}

describe('resolveDispatchedLotExpiry (FR-MQW-06 B)', () => {
	it('follows the dispatch row lot_ref to the lot expiry in two reads', async () => {
		const dispatchId = await deriveDeterministicLedgerId('dispatch', TICKET, ITEM);
		const repo = reader([
			{ _id: dispatchId, lot_ref: LOT_ID },
			{ _id: LOT_ID, lot: { expiry: EXPIRY } }
		]);

		await expect(resolveDispatchedLotExpiry(TICKET, ITEM, repo)).resolves.toBe(EXPIRY);
		expect(repo.reads).toEqual([dispatchId, LOT_ID]);
	});

	it('uses the dispatch row itself when it points lot_ref at itself', async () => {
		const dispatchId = await deriveDeterministicLedgerId('dispatch', TICKET, ITEM);
		const repo = reader([{ _id: dispatchId, lot_ref: dispatchId }]);

		await expect(resolveDispatchedLotExpiry(TICKET, ITEM, repo)).resolves.toBeUndefined();
		expect(repo.reads).toEqual([dispatchId]);
	});

	it('is undefined when the ticket item was never dispatched', async () => {
		await expect(resolveDispatchedLotExpiry(TICKET, ITEM, reader([]))).resolves.toBeUndefined();
	});

	it('is undefined when the lot carries no expiry', async () => {
		const dispatchId = await deriveDeterministicLedgerId('dispatch', TICKET, ITEM);
		const repo = reader([{ _id: dispatchId, lot_ref: LOT_ID }, { _id: LOT_ID }]);

		await expect(resolveDispatchedLotExpiry(TICKET, ITEM, repo)).resolves.toBeUndefined();
	});
});
