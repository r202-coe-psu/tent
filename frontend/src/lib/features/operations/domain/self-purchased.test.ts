import { describe, expect, it } from 'vitest';
import {
	createStockLedger,
	stockLedgerInputSchema,
	type StockLedger,
	type StockLedgerInput
} from './operations';
import {
	defaultSelfPurchasedRange,
	isSelfPurchasedLot,
	selfPurchasedLotRefs,
	summarizeSelfPurchased
} from './self-purchased';
import { projectLotsByItem } from './operations';

const ctx = { shelterCode: 'SH001', createdBy: 'staff' };

let seq = 0;
function row(over: Partial<StockLedger> & Pick<StockLedger, 'qty' | 'reason'>): StockLedger {
	seq += 1;
	const id = `stock_ledger:${String(seq).padStart(26, '0')}`;
	return {
		_id: id,
		type: 'stock_ledger',
		schema_v: 7,
		shelter_code: 'SH001',
		created_at: '2026-11-01T00:00:00.000Z',
		updated_at: '2026-11-01T00:00:00.000Z',
		created_by: 'staff',
		item_id: 'item:rice',
		unit: 'kg',
		ref_id: null,
		occurred_at: '2026-11-01T03:00:00.000Z',
		...over
	} as StockLedger;
}

const receive = (qty: string, selfPurchased?: boolean, over: Partial<StockLedger> = {}) =>
	row({
		qty,
		reason: 'adjust',
		adjust_reason: 'found',
		...(selfPurchased ? { lot: { self_purchased: true } } : {}),
		...over
	});

describe('self_purchased on the ledger write path (schema_v 7)', () => {
	const base = { item_id: 'item:rice', qty: '5', unit: 'kg' };

	it.each([
		['receive (pooled)', { ref_id: 'bulk_return_pool:01J' }],
		['receive (kitchen output)', { ref_id: 'meal_service:01J' }],
		['receive (leftover return)', { ref_id: 'requisition_ticket:01J' }]
	])('rejects self_purchased: true on %s (CR-234 FR-2)', (_name, over) => {
		const input = {
			...base,
			reason: 'receive',
			lot: { self_purchased: true },
			...over
		} as StockLedgerInput;
		const parsed = stockLedgerInputSchema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues.map((i) => i.path.join('.'))).toEqual(['lot.self_purchased']);
		}
		expect(() => createStockLedger(input, ctx)).toThrow();
	});

	it('self_purchased: false on a receive row is stripped, not rejected', () => {
		const entry = createStockLedger(
			{
				...base,
				reason: 'receive',
				ref_id: 'bulk_return_pool:01J',
				lot: { self_purchased: false }
			},
			ctx
		);
		expect(entry.lot).not.toHaveProperty('self_purchased');
		expect(entry.schema_v).toBe(7);
	});

	it('a manual-receipt row (adjust / found) may carry it', () => {
		const entry = createStockLedger(
			{ ...base, reason: 'adjust', adjust_reason: 'found', lot: { self_purchased: true } },
			ctx
		);
		expect(entry.lot?.self_purchased).toBe(true);
		expect(entry.schema_v).toBe(7);
	});

	it.each([
		['donation', { reason: 'donation', ref_id: 'donation:01J' }],
		['transfer_in', { reason: 'transfer_in', ref_id: 'stock_transfer:01J' }],
		[
			'distribute',
			{
				reason: 'distribute',
				qty: '-1',
				ref_id: 'requisition_ticket:01J',
				lot_ref: 'stock_ledger:01J'
			}
		],
		[
			'distribution_return',
			{
				reason: 'distribution_return',
				ref_id: 'requisition_ticket:01J',
				lot_ref: 'stock_ledger:01J'
			}
		],
		['adjust (not found)', { reason: 'adjust', adjust_reason: 'lost' }]
	])('rejects self_purchased: true on %s (decision: reject, not strip)', (_name, over) => {
		const input = { ...base, lot: { self_purchased: true }, ...over } as StockLedgerInput;
		const parsed = stockLedgerInputSchema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues.some((i) => i.path.join('.') === 'lot.self_purchased')).toBe(true);
		}
		expect(() => createStockLedger(input, ctx)).toThrow();
	});

	it('rejects self_purchased: true on an outbound adjust/found row', () => {
		expect(() =>
			createStockLedger(
				{
					...base,
					qty: '-2',
					reason: 'adjust',
					adjust_reason: 'found',
					lot: { self_purchased: true }
				},
				ctx
			)
		).toThrow();
	});

	it('self_purchased: false is dropped, never persisted', () => {
		const entry = createStockLedger(
			{
				...base,
				reason: 'donation',
				ref_id: 'donation:01J',
				lot: { self_purchased: false, expiry: '2027-01-01' }
			},
			ctx
		);
		expect(entry.lot).not.toHaveProperty('self_purchased');
		expect(entry.lot?.expiry).toBe('2027-01-01');
	});
});

describe('selfPurchasedLotRefs / isSelfPurchasedLot', () => {
	it('a flagged receipt is self-purchased; an unflagged one and a legacy row are not', () => {
		const flagged = receive('10', true);
		const plain = receive('4');
		const legacy = row({
			qty: '3',
			reason: 'receive',
			ref_id: 'distribution_log:01J',
			schema_v: 6
		});
		const refs = selfPurchasedLotRefs([flagged, plain, legacy]);
		expect(refs).toEqual(new Set([flagged._id]));
		expect(isSelfPurchasedLot(flagged._id, refs)).toBe(true);
		expect(isSelfPurchasedLot(plain._id, refs)).toBe(false);
		expect(isSelfPurchasedLot(legacy._id, refs)).toBe(false);
	});

	it('a distribution_return into a self-purchased lot keeps that lot self-purchased (by lot_ref)', () => {
		const bought = receive('10', true);
		const back = row({
			qty: '2',
			reason: 'distribution_return',
			ref_id: 'requisition_ticket:01J',
			lot_ref: bought._id as `stock_ledger:${string}`
		});
		const refs = selfPurchasedLotRefs([bought, back]);
		const lots = projectLotsByItem([bought, back]).lots;
		expect(lots).toHaveLength(1);
		expect(lots[0].qty).toBe('12');
		expect(isSelfPurchasedLot(lots[0].lot_ref, refs)).toBe(true);
	});

	it('a stray flag on a receive row does not make a lot self-purchased', () => {
		const stray = row({
			qty: '5',
			reason: 'receive',
			ref_id: 'distribution_log:01J',
			lot: { self_purchased: true }
		});
		expect(selfPurchasedLotRefs([stray]).size).toBe(0);
	});

	it('a transfer_in is never self-purchased, even if a stray row carries the flag', () => {
		const incoming = row({
			qty: '8',
			reason: 'transfer_in',
			ref_id: 'stock_transfer:01J',
			lot: { self_purchased: true }
		});
		expect(selfPurchasedLotRefs([incoming]).size).toBe(0);
	});
});

describe('summarizeSelfPurchased (Asia/Bangkok day boundaries)', () => {
	const NOW = new Date('2026-11-05T09:00:00.000Z'); // 16:00 on 5 Nov in Bangkok

	it('counts received qty by Bangkok day: 17:00Z is already the next day', () => {
		const lateNov1 = receive('5', true, { occurred_at: '2026-11-01T16:59:59.000Z' }); // 23:59:59 on 1 Nov
		const earlyNov2 = receive('7', true, { occurred_at: '2026-11-01T17:00:00.000Z' }); // 00:00 on 2 Nov
		const { rows } = summarizeSelfPurchased(
			[lateNov1, earlyNov2],
			{ from: '2026-11-02', to: '2026-11-02' },
			NOW
		);
		expect(rows).toEqual([{ item_id: 'item:rice', unit: 'kg', receivedQty: '7', onHandQty: '12' }]);
		const day1 = summarizeSelfPurchased(
			[lateNov1, earlyNov2],
			{ from: '2026-11-01', to: '2026-11-01' },
			NOW
		);
		expect(day1.rows[0].receivedQty).toBe('5');
	});

	it('on-hand counts only self-purchased lots, net of what was issued from them', () => {
		const bought = receive('10', true);
		const donated = row({
			qty: '50',
			reason: 'donation',
			ref_id: 'donation:01J',
			lot_ref: undefined
		});
		const issued = row({
			qty: '-4',
			reason: 'distribute',
			ref_id: 'requisition_ticket:01J',
			lot_ref: bought._id as `stock_ledger:${string}`
		});
		const { rows } = summarizeSelfPurchased(
			[bought, donated, issued],
			{ from: '2026-11-01', to: '2026-11-05' },
			NOW
		);
		expect(rows).toEqual([{ item_id: 'item:rice', unit: 'kg', receivedQty: '10', onHandQty: '6' }]);
	});

	it('a lot bought before the range still shows its on-hand with received 0', () => {
		const old = receive('9', true, { occurred_at: '2026-09-01T03:00:00.000Z' });
		const { rows } = summarizeSelfPurchased([old], { from: '2026-11-01', to: '2026-11-05' }, NOW);
		expect(rows).toEqual([{ item_id: 'item:rice', unit: 'kg', receivedQty: '0', onHandQty: '9' }]);
	});

	it('transfer_in and unflagged receipts are not counted; old rows without the field are fine', () => {
		const incoming = row({ qty: '8', reason: 'transfer_in', ref_id: 'stock_transfer:01J' });
		const legacy = row({
			qty: '3',
			reason: 'receive',
			ref_id: 'distribution_log:01J',
			schema_v: 6
		});
		const { rows } = summarizeSelfPurchased(
			[incoming, legacy],
			{ from: '2026-11-01', to: '2026-11-05' },
			NOW
		);
		expect(rows).toEqual([]);
	});

	it('defaults to the month so far, from a fixed now', () => {
		expect(defaultSelfPurchasedRange(NOW)).toEqual({ from: '2026-11-01', to: '2026-11-05' });
		const inMonth = receive('2', true, { occurred_at: '2026-11-03T03:00:00.000Z' });
		const before = receive('3', true, { occurred_at: '2026-10-31T03:00:00.000Z' });
		const { rows } = summarizeSelfPurchased([inMonth, before], undefined, NOW);
		expect(rows[0].receivedQty).toBe('2');
		expect(rows[0].onHandQty).toBe('5');
	});

	it('a from after to is swapped', () => {
		const r = receive('2', true, { occurred_at: '2026-11-03T03:00:00.000Z' });
		const { rows } = summarizeSelfPurchased([r], { from: '2026-11-05', to: '2026-11-01' }, NOW);
		expect(rows[0].receivedQty).toBe('2');
	});
});
