import { describe, expect, it } from 'vitest';
import type { StockLedger } from '$lib/features/operations';
import { createStockLedger } from '$lib/features/operations';
import type { AuthorContext } from '$lib/db/model';
import { getEligiblePhysicalLots, isLotDateExpired } from './physical-lot';

const ctx: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'tester_user',
	roles: ['shelter:SH001', 'SH001:warehouse_staff']
};

const createInboundLedger = (
	id: string,
	itemId: string,
	qty: string,
	occurredAt: string,
	lot?: { lot_no?: string; expiry?: string; storage_zone?: string; note?: string },
	lotRef?: string
): StockLedger => {
	const entry = createStockLedger(
		{
			item_id: itemId,
			qty,
			unit: 'กล่อง',
			reason: 'receive',
			ref_id: 'requisition_ticket:tkt_receive_001',
			lot,
			occurred_at: occurredAt
		},
		ctx,
		id
	);
	return lotRef ? { ...entry, lot_ref: lotRef } : entry;
};

const createOutboundLedger = (
	id: string,
	itemId: string,
	qty: string,
	occurredAt: string,
	lotRef: string
): StockLedger => {
	const entry = createStockLedger(
		{
			item_id: itemId,
			qty: `-${qty}`,
			unit: 'กล่อง',
			reason: 'distribute',
			ref_id: 'requisition_ticket:tkt_dist_001',
			lot_ref: lotRef,
			occurred_at: occurredAt
		},
		ctx,
		id
	);
	return entry;
};

describe('Physical Lot Projection & FEFO Ordering (Slice 5.3)', () => {
	const refDate = new Date('2026-06-01T00:00:00.000Z');

	it('returns empty array when ledger is empty or undefined', () => {
		expect(getEligiblePhysicalLots(undefined, 'item:rice', '10')).toEqual([]);
		expect(getEligiblePhysicalLots([], 'item:rice', '10')).toEqual([]);
		expect(getEligiblePhysicalLots([], '', '10')).toEqual([]);
	});

	it('orders available lots according to FEFO (earliest expiry first)', () => {
		const ledger: StockLedger[] = [
			createInboundLedger('L1', 'item:meal', '50', '2026-05-01T08:00:00Z', {
				lot_no: 'L-260501-001',
				expiry: '2026-07-01'
			}),
			createInboundLedger('L2', 'item:meal', '50', '2026-05-01T09:00:00Z', {
				lot_no: 'L-260501-002',
				expiry: '2026-06-15'
			}),
			createInboundLedger('L3', 'item:meal', '50', '2026-05-01T10:00:00Z', {
				lot_no: 'L-260501-003',
				expiry: '2026-08-01'
			})
		];

		const lots = getEligiblePhysicalLots(ledger, 'item:meal', '30', refDate);
		expect(lots).toHaveLength(3);
		expect(lots[0].lot_no).toBe('L-260501-002'); // 2026-06-15
		expect(lots[1].lot_no).toBe('L-260501-001'); // 2026-07-01
		expect(lots[2].lot_no).toBe('L-260501-003'); // 2026-08-01
	});

	it('places lots without expiry date after lots with expiry dates', () => {
		const ledger: StockLedger[] = [
			createInboundLedger('L_NO_EXP', 'item:supplies', '100', '2026-05-01T08:00:00Z', {
				lot_no: 'L-260501-001'
			}),
			createInboundLedger('L_EXP', 'item:supplies', '50', '2026-05-01T09:00:00Z', {
				lot_no: 'L-260501-002',
				expiry: '2026-09-01'
			})
		];

		const lots = getEligiblePhysicalLots(ledger, 'item:supplies', '20', refDate);
		expect(lots).toHaveLength(2);
		expect(lots[0].lot_no).toBe('L-260501-002');
		expect(lots[1].lot_no).toBe('L-260501-001');
	});

	it('excludes lots belonging to other items', () => {
		const ledger: StockLedger[] = [
			createInboundLedger('L1', 'item:food', '50', '2026-05-01T08:00:00Z', {
				lot_no: 'L-260501-010'
			}),
			createInboundLedger('L2', 'item:water', '100', '2026-05-01T09:00:00Z', {
				lot_no: 'L-260501-011'
			})
		];

		const lots = getEligiblePhysicalLots(ledger, 'item:food', '10', refDate);
		expect(lots).toHaveLength(1);
		expect(lots[0].lot_no).toBe('L-260501-010');
	});

	it('excludes exhausted (zero balance) lots', () => {
		const inEntry = createInboundLedger('L1', 'item:blanket', '20', '2026-05-01T08:00:00Z', {
			lot_no: 'L-260501-020'
		});
		const outEntry = createOutboundLedger(
			'OUT1',
			'item:blanket',
			'20',
			'2026-05-02T08:00:00Z',
			inEntry.lot_ref ?? inEntry._id
		);

		const lots = getEligiblePhysicalLots([inEntry, outEntry], 'item:blanket', '10', refDate);
		expect(lots).toHaveLength(0);
	});

	it('flags insufficient quantity when lot balance is less than required allocation', () => {
		const ledger: StockLedger[] = [
			createInboundLedger('L1', 'item:meal', '20', '2026-05-01T08:00:00Z', {
				lot_no: 'L-260501-030',
				expiry: '2026-07-01'
			}),
			createInboundLedger('L2', 'item:meal', '100', '2026-05-01T09:00:00Z', {
				lot_no: 'L-260501-031',
				expiry: '2026-07-15'
			})
		];

		const lots = getEligiblePhysicalLots(ledger, 'item:meal', '50', refDate);
		expect(lots).toHaveLength(2);

		const small = lots.find((l) => l.lot_no === 'L-260501-030');
		const large = lots.find((l) => l.lot_no === 'L-260501-031');

		expect(small?.hasSufficientQty).toBe(false);
		expect(large?.hasSufficientQty).toBe(true);
	});

	it('flags expired lots accurately based on reference time', () => {
		expect(isLotDateExpired('2026-05-01', refDate)).toBe(true);
		expect(isLotDateExpired('2026-07-01', refDate)).toBe(false);
		expect(isLotDateExpired(undefined, refDate)).toBe(false);

		const ledger: StockLedger[] = [
			createInboundLedger('L_EXPIRED', 'item:meal', '50', '2026-04-01T08:00:00Z', {
				lot_no: 'L-260401-040',
				expiry: '2026-05-01'
			}),
			createInboundLedger('L_FRESH', 'item:meal', '50', '2026-05-01T08:00:00Z', {
				lot_no: 'L-260501-041',
				expiry: '2026-07-01'
			})
		];

		const lots = getEligiblePhysicalLots(ledger, 'item:meal', '30', refDate);
		expect(lots.find((l) => l.lot_no === 'L-260401-040')?.isExpired).toBe(true);
		expect(lots.find((l) => l.lot_no === 'L-260501-041')?.isExpired).toBe(false);
	});
});
