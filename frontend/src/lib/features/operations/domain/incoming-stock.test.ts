import { describe, it, expect } from 'vitest';
import {
	aggregateIncoming,
	deriveDonationIncoming,
	deriveTransferIncoming,
	donationIncomingDate,
	type IncomingCatalog,
	type IncomingDonationDoc,
	type IncomingRow,
	type IncomingTransferDoc
} from './incoming-stock';

// 2026-11-06 12:00 Bangkok -> Bangkok today = 2026-11-06
const NOW = new Date('2026-11-06T05:00:00Z');

const catalog: IncomingCatalog = new Map([
	['item_master:rice', { base_unit: 'kg', conversions: [{ uom_name: 'sack', multiplier: '25' }] }],
	[
		'item_master:water',
		{ base_unit: 'bottle', conversions: [{ uom_name: 'pack', multiplier: '0.5' }] }
	]
]);

function donation(over: Partial<IncomingDonationDoc> = {}): IncomingDonationDoc {
	return {
		_id: 'donation:01',
		kind: 'items',
		status: 'verifying',
		booking_ref: 'DN-000001',
		logistics: {
			delivery_method: 'self_dropoff',
			slot: { date: '2026-11-10', from: '09:00', to: '10:00' }
		},
		items: [{ item_id: 'item_master:rice', qty: '2', unit: 'sack', review_status: 'approved' }],
		...over
	};
}

describe('deriveDonationIncoming', () => {
	it('converts an approved packaging line to the base unit with Decimal (2 sack x 25 = 50 kg)', () => {
		const r = deriveDonationIncoming(donation(), 'SH001', catalog, NOW);
		expect(r.unmatched).toEqual([]);
		expect(r.rows).toEqual([
			{
				source: 'donation',
				ref: 'DN-000001',
				doc_id: 'donation:01',
				item_id: 'item_master:rice',
				qty: '50',
				date: '2026-11-10',
				overdue: false,
				shelter_code: 'SH001'
			}
		]);
	});

	it('keeps decimals exact (3 pack x 0.5 = 1.5, 0.1 + 0.2 style sums stay exact)', () => {
		const r = deriveDonationIncoming(
			donation({
				items: [{ item_id: 'item_master:water', qty: '3', unit: 'pack', review_status: 'approved' }]
			}),
			'SH001',
			catalog,
			NOW
		);
		expect(r.rows[0].qty).toBe('1.5');
	});

	it.each(['received', 'rejected', 'expired', 'cancelled', 'redirected'] as const)(
		'ignores a booking in status %s',
		(status) => {
			const r = deriveDonationIncoming(donation({ status }), 'SH001', catalog, NOW);
			expect(r.rows).toEqual([]);
			expect(r.unmatched).toEqual([]);
		}
	);

	it.each(['declared', 'pending_review', 'verifying'] as const)('counts status %s', (status) => {
		expect(deriveDonationIncoming(donation({ status }), 'SH001', catalog, NOW).rows).toHaveLength(
			1
		);
	});

	it('counts only approved lines (pending, rejected and unreviewed are skipped)', () => {
		const r = deriveDonationIncoming(
			donation({
				items: [
					{ item_id: 'item_master:rice', qty: '1', unit: 'kg', review_status: 'pending' },
					{ item_id: 'item_master:rice', qty: '2', unit: 'kg', review_status: 'rejected' },
					{ item_id: 'item_master:rice', qty: '4', unit: 'kg' },
					{ item_id: 'item_master:rice', qty: '8', unit: 'kg', review_status: 'approved' }
				]
			}),
			'SH001',
			catalog,
			NOW
		);
		expect(r.rows.map((x) => x.qty)).toEqual(['8']);
	});

	it('skips money donations', () => {
		expect(deriveDonationIncoming(donation({ kind: 'money' }), 'SH001', catalog, NOW).rows).toEqual(
			[]
		);
	});

	it('skips a line a drop-off point already received (no double count with the ledger)', () => {
		const r = deriveDonationIncoming(
			donation({
				items: [
					{ item_id: 'item_master:rice', qty: '1', unit: 'kg', review_status: 'approved' },
					{ item_id: 'item_master:rice', qty: '5', unit: 'kg', review_status: 'approved' }
				],
				point_receipts: [
					{
						point_id: 'p1',
						line_nos: [0],
						received_at: '2026-11-06T00:00:00Z',
						received_by: 'u',
						audit_id: 'a',
						ledger_ids: [],
						items: []
					}
				]
			}),
			'SH001',
			catalog,
			NOW
		);
		expect(r.rows.map((x) => x.qty)).toEqual(['5']);
	});

	it('sends free_text, unknown item and unconvertible unit to unmatched, not to rows', () => {
		const r = deriveDonationIncoming(
			donation({
				items: [
					{ free_text: ' ผ้าห่ม ', qty: '10', unit: 'ผืน', review_status: 'approved' },
					{ item_id: 'item_master:ghost', qty: '3', unit: 'kg', review_status: 'approved' },
					{ item_id: 'item_master:rice', qty: '3', unit: 'box', review_status: 'approved' }
				]
			}),
			'SH001',
			catalog,
			NOW
		);
		expect(r.rows).toEqual([]);
		expect(r.unmatched.map((u) => [u.reason, u.label, u.qty, u.unit])).toEqual([
			['free_text', 'ผ้าห่ม', '10', 'ผืน'],
			['unknown_item', null, '3', 'kg'],
			['unit_mismatch', null, '3', 'box']
		]);
	});

	it('falls back to _id when the walk-in has no booking_ref', () => {
		const r = deriveDonationIncoming(donation({ booking_ref: undefined }), 'SH001', catalog, NOW);
		expect(r.rows[0].ref).toBe('donation:01');
	});

	describe('date and overdue', () => {
		it('uses slot.date over eta', () => {
			const d = donation({
				logistics: {
					delivery_method: 'self_dropoff',
					slot: { date: '2026-11-08', from: '09:00', to: '10:00' },
					eta: '2026-11-20T03:00:00Z'
				}
			});
			expect(donationIncomingDate(d)).toBe('2026-11-08');
		});

		it('falls back to the Bangkok day of eta (2026-11-19T20:00Z is 11-20 03:00 Bangkok)', () => {
			const d = donation({
				logistics: { delivery_method: 'parcel', slot: null, eta: '2026-11-19T20:00:00Z' }
			});
			expect(donationIncomingDate(d)).toBe('2026-11-20');
		});

		it('has no date when neither slot nor eta exists, and is then never overdue', () => {
			const r = deriveDonationIncoming(donation({ logistics: undefined }), 'SH001', catalog, NOW);
			expect(r.rows[0].date).toBeNull();
			expect(r.rows[0].overdue).toBe(false);
		});

		it('is overdue only when the day is before today in Bangkok', () => {
			const at = (slot: string) =>
				deriveDonationIncoming(
					donation({
						logistics: {
							delivery_method: 'self_dropoff',
							slot: { date: slot, from: '09:00', to: '10:00' }
						}
					}),
					'SH001',
					catalog,
					NOW
				).rows[0].overdue;
			expect(at('2026-11-05')).toBe(true);
			expect(at('2026-11-06')).toBe(false);
			expect(at('2026-11-07')).toBe(false);
		});

		it('uses Bangkok day semantics: 2026-11-06T18:00Z is already 11-07 in Bangkok', () => {
			const late = new Date('2026-11-06T18:00:00Z');
			const r = deriveDonationIncoming(
				donation({
					logistics: {
						delivery_method: 'self_dropoff',
						slot: { date: '2026-11-06', from: '09:00', to: '10:00' }
					}
				}),
				'SH001',
				catalog,
				late
			);
			expect(r.rows[0].overdue).toBe(true);
		});

		it('flags unmatched lines overdue too', () => {
			const r = deriveDonationIncoming(
				donation({
					logistics: {
						delivery_method: 'self_dropoff',
						slot: { date: '2026-11-01', from: '09:00', to: '10:00' }
					},
					items: [{ free_text: 'x', qty: '1', unit: 'ea', review_status: 'approved' }]
				}),
				'SH001',
				catalog,
				NOW
			);
			expect(r.unmatched[0].overdue).toBe(true);
		});
	});
});

describe('deriveTransferIncoming', () => {
	function transfer(over: Partial<IncomingTransferDoc> = {}): IncomingTransferDoc {
		return {
			_id: 'stock_transfer:T1',
			status: 'shipped',
			to_shelter: 'SH002',
			items: [{ item_id: 'item_master:rice', qty: '12.5', unit: 'kg' }],
			timeline: {
				requested: { at: '2026-11-01T00:00:00Z', by: 'a' },
				shipped: { at: '2026-11-05T18:30:00Z', by: 'b' }
			},
			...over
		};
	}

	it('turns a shipped transfer into rows dated by timeline.shipped.at (Bangkok day)', () => {
		expect(deriveTransferIncoming(transfer())).toEqual([
			{
				source: 'transfer',
				ref: 'stock_transfer:T1',
				doc_id: 'stock_transfer:T1',
				item_id: 'item_master:rice',
				qty: '12.5',
				date: '2026-11-06',
				overdue: false,
				shelter_code: 'SH002'
			}
		]);
	});

	it.each(['requested', 'disputed', 'received', 'cancelled'] as const)(
		'ignores status %s',
		(status) => {
			expect(deriveTransferIncoming(transfer({ status }))).toEqual([]);
		}
	);
});

describe('aggregateIncoming', () => {
	const row = (over: Partial<IncomingRow>): IncomingRow => ({
		source: 'donation',
		ref: 'R',
		doc_id: 'd',
		item_id: 'i1',
		qty: '1',
		date: null,
		overdue: false,
		shelter_code: 'SH001',
		...over
	});

	it('sums per item with Decimal (0.1 + 0.2 = 0.3) and keeps items apart', () => {
		const out = aggregateIncoming([
			row({ ref: 'A', qty: '0.1' }),
			row({ ref: 'B', qty: '0.2' }),
			row({ ref: 'C', item_id: 'i2', qty: '7' })
		]);
		expect(out.map((t) => [t.item_id, t.qty])).toEqual([
			['i1', '0.3'],
			['i2', '7']
		]);
	});

	it('picks the earliest date, ignoring undated rows, and orders rows dated-first', () => {
		const out = aggregateIncoming([
			row({ ref: 'A', date: null }),
			row({ ref: 'B', date: '2026-11-12' }),
			row({ ref: 'C', date: '2026-11-08', source: 'transfer' })
		]);
		expect(out[0].earliest_date).toBe('2026-11-08');
		expect(out[0].rows.map((r) => r.ref)).toEqual(['C', 'B', 'A']);
	});

	it('has a null earliest date when nothing is dated, and nothing for no rows', () => {
		expect(aggregateIncoming([row({})])[0].earliest_date).toBeNull();
		expect(aggregateIncoming([])).toEqual([]);
	});

	it('adds donation and transfer rows of one item together', () => {
		const out = aggregateIncoming([
			row({ qty: '50', date: '2026-11-10' }),
			row({ source: 'transfer', ref: 'T', qty: '12.5', date: '2026-11-06' })
		]);
		expect(out[0].qty).toBe('62.5');
		expect(out[0].earliest_date).toBe('2026-11-06');
	});
});
