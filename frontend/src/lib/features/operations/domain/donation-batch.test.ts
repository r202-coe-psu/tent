import { describe, expect, it } from 'vitest';
import { deriveDonationReceiptLineId, donationShortfall, isReceivedLine } from './donation-batch';

describe('donationShortfall (CR-143 FR-B5)', () => {
	it('AC-B2: received 8 of 10 reports a shortfall of 2', () => {
		expect(
			donationShortfall([{ item_id: 'item:rice', qty: '10' }], [{ item_id: 'item:rice', qty: '8' }])
		).toEqual([{ item_id: 'item:rice', declared: '10', counted: '8', short: '2' }]);
	});

	it('reports nothing when everything declared was received', () => {
		expect(
			donationShortfall(
				[{ item_id: 'item:rice', qty: '10' }],
				[{ item_id: 'item:rice', qty: '10' }]
			)
		).toEqual([]);
	});

	it('treats an item that was not counted at all as fully short', () => {
		expect(donationShortfall([{ item_id: 'item:rice', qty: '10' }], [])).toEqual([
			{ item_id: 'item:rice', declared: '10', counted: '0', short: '10' }
		]);
		expect(
			donationShortfall([{ item_id: 'item:rice', qty: '10' }], [{ item_id: 'item:rice', qty: '0' }])
		).toHaveLength(1);
	});

	it('is not a shortfall to receive more than declared, or an item off the ticket', () => {
		expect(
			donationShortfall(
				[{ item_id: 'item:rice', qty: '10' }],
				[
					{ item_id: 'item:rice', qty: '12' },
					{ item_id: 'item:water', qty: '5' }
				]
			)
		).toEqual([]);
	});

	it('sums several lines of the same item on both sides', () => {
		expect(
			donationShortfall(
				[
					{ item_id: 'item:rice', qty: '6' },
					{ item_id: 'item:rice', qty: '4' }
				],
				[
					{ item_id: 'item:rice', qty: '3' },
					{ item_id: 'item:rice', qty: '4.5' }
				]
			)
		).toEqual([{ item_id: 'item:rice', declared: '10', counted: '7.5', short: '2.5' }]);
	});

	it('ignores declared lines that have no item yet (free_text not matched)', () => {
		expect(donationShortfall([{ item_id: undefined, qty: '10' }], [])).toEqual([]);
	});
});

describe('deriveDonationReceiptLineId (CR-143 FR-B4a)', () => {
	it('is stable for the same (donation, item, line)', async () => {
		const a = await deriveDonationReceiptLineId('donation:D1', 'item:rice', 0);
		const b = await deriveDonationReceiptLineId('donation:D1', 'item:rice', 0);
		expect(a).toBe(b);
		expect(a).toMatch(/^stock_ledger:[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it('differs when any of the three parts differs', async () => {
		const base = await deriveDonationReceiptLineId('donation:D1', 'item:rice', 0);
		expect(await deriveDonationReceiptLineId('donation:D2', 'item:rice', 0)).not.toBe(base);
		expect(await deriveDonationReceiptLineId('donation:D1', 'item:water', 0)).not.toBe(base);
		expect(await deriveDonationReceiptLineId('donation:D1', 'item:rice', 1)).not.toBe(base);
	});
});

describe('isReceivedLine (CR-143 FR-B3)', () => {
	it('a zero line is not received', () => {
		expect(isReceivedLine({ qty: '0' })).toBe(false);
		expect(isReceivedLine({ qty: '0.0000' })).toBe(false);
		expect(isReceivedLine({ qty: '0.5' })).toBe(true);
	});
});
