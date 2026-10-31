import { describe, expect, it } from 'vitest';
import { buildDonationLotRows, lotHistoryQuery } from './donation-lots';
import type { StockLedger } from './operations';

let seq = 0;
const row = (over: Partial<StockLedger> & { occurred_at?: string }): StockLedger =>
	({
		_id: `stock_ledger:${String(++seq).padStart(4, '0')}`,
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: 'SH001',
		item_id: 'item_master:rice',
		qty: '10',
		unit: 'kg',
		reason: 'donation',
		ref_id: 'donation:w001',
		occurred_at: '2026-10-20T03:00:00.000Z',
		...over
	}) as StockLedger;

/** A receipt row that is its own physical lot (`lot_ref === _id`), as the writers mint it. */
const receipt = (over: Partial<StockLedger> = {}) => {
	const r = row(over);
	return { ...r, lot_ref: r._id } as StockLedger;
};

describe('buildDonationLotRows (#821 FR-12)', () => {
	it('lists item, quantity, lot number, expiry and place of each received line', () => {
		const a = receipt({
			qty: '10',
			lot: { lot_no: 'L-261020-001', expiry: '2027-01-31', storage_zone: 'โกดัง A' }
		});

		const [r] = buildDonationLotRows([a], [a]);

		expect(r).toMatchObject({
			itemId: 'item_master:rice',
			qty: '10',
			unit: 'kg',
			lotNo: 'L-261020-001',
			expiry: '2027-01-31',
			remaining: '10'
		});
		expect(r.lot?.storage_zone).toBe('โกดัง A');
	});

	it('shows no lot number for a row from before CR-088 (lotNo null, rendered "—")', () => {
		const old = row({ lot: undefined });

		expect(buildDonationLotRows([old], [old])[0]).toMatchObject({ lotNo: null, expiry: null });
	});

	it('remaining is what is left of THAT lot, after distributions that name its lot_ref', () => {
		const lotA = receipt({ qty: '10', lot: { lot_no: 'L-261020-001' } });
		const lotB = receipt({ qty: '5', lot: { lot_no: 'L-261020-002' } });
		const out = row({
			reason: 'distribute',
			ref_id: 'requisition_ticket:1',
			qty: '-4',
			lot_ref: lotA._id,
			occurred_at: '2026-10-21T03:00:00.000Z'
		});

		const rows = buildDonationLotRows([lotA, lotB], [lotA, lotB, out]);

		expect(rows.find((r) => r.lotNo === 'L-261020-001')?.remaining).toBe('6');
		expect(rows.find((r) => r.lotNo === 'L-261020-002')?.remaining).toBe('5');
	});

	it('a fully used lot shows 0, not blank', () => {
		const lot = receipt({ qty: '3' });
		const out = row({
			reason: 'distribute',
			qty: '-3',
			lot_ref: lot._id,
			occurred_at: '2026-10-21T03:00:00.000Z'
		});

		expect(buildDonationLotRows([lot], [lot, out])[0].remaining).toBe('0');
	});

	it('uses the row _id as the lot when a row from before lot_ref has none', () => {
		const legacy = row({ qty: '7' });

		expect(buildDonationLotRows([legacy], [legacy])[0].remaining).toBe('7');
	});

	it('shows no balance (null) for an item whose history cannot be replayed, and keeps the other items', () => {
		const rice = receipt({ qty: '10' });
		const brokenReceipt = receipt({ item_id: 'item_master:salt', qty: '1', unit: 'kg' });
		// An outflow that names the lot under another unit is corrupt history (fails closed, #855).
		const unitMismatch = row({
			item_id: 'item_master:salt',
			reason: 'distribute',
			qty: '-1',
			unit: 'g',
			lot_ref: brokenReceipt._id,
			occurred_at: '2026-10-21T03:00:00.000Z'
		});

		const rows = buildDonationLotRows([rice, brokenReceipt], [rice, brokenReceipt, unitMismatch]);

		expect(rows.find((r) => r.itemId === 'item_master:salt')?.remaining).toBeNull();
		expect(rows.find((r) => r.itemId === 'item_master:rice')?.remaining).toBe('10');
	});

	it('shows the negative balance of an overdrawn lot (#855)', () => {
		const salt = receipt({ item_id: 'item_master:salt', qty: '1', unit: 'kg' });
		const overdraw = row({
			item_id: 'item_master:salt',
			reason: 'distribute',
			qty: '-5',
			lot_ref: salt._id,
			occurred_at: '2026-10-21T03:00:00.000Z'
		});

		expect(buildDonationLotRows([salt], [salt, overdraw])[0].remaining).toBe('-4');
	});

	it('takes only donation receipts: other reasons and outbound rows are not lots of the donation', () => {
		const lot = receipt({ qty: '10' });
		const out = row({ reason: 'distribute', qty: '-1', lot_ref: lot._id });
		const other = row({ reason: 'receive', qty: '5' });

		expect(buildDonationLotRows([lot, out, other], [lot, out, other])).toHaveLength(1);
	});

	it('orders by item, then lot number', () => {
		const b = receipt({ item_id: 'item_master:b', lot: { lot_no: 'L-261020-002' } });
		const a2 = receipt({ item_id: 'item_master:a', lot: { lot_no: 'L-261020-002' } });
		const a1 = receipt({ item_id: 'item_master:a', lot: { lot_no: 'L-261020-001' } });

		const rows = buildDonationLotRows([b, a2, a1], [b, a2, a1]);

		expect(rows.map((r) => `${r.itemId}|${r.lotNo}`)).toEqual([
			'item_master:a|L-261020-001',
			'item_master:a|L-261020-002',
			'item_master:b|L-261020-002'
		]);
	});

	it('is empty for a donation with no receipt rows', () => {
		expect(buildDonationLotRows([], [])).toEqual([]);
	});
});

describe('lotHistoryQuery (#811 movements tab)', () => {
	it('opens the movements tab, all dates, searching the lot number', () => {
		const params = new URLSearchParams(lotHistoryQuery('L-261020-001'));

		expect(params.get('tab')).toBe('movements');
		expect(params.get('range')).toBe('all');
		expect(params.get('lq')).toBe('L-261020-001');
	});
});
