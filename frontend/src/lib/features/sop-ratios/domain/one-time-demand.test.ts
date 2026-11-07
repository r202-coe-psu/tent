import { describe, expect, it } from 'vitest';
import {
	buildOneTimeDemandRows,
	coverageBarWidth,
	countCurrentRecipients,
	presentRecipientKeys,
	formatCoveragePercent,
	oneTimeItemIds,
	sortOneTimeDemandRows,
	type OneTimeDemandItem,
	type OneTimeDemandLot,
	type OneTimeDemandReservation
} from './one-time-demand';

// 2026-11-05 12:00 Asia/Bangkok
const NOW = Date.parse('2026-11-05T05:00:00.000Z');

const net: OneTimeDemandItem = {
	_id: 'item_master:net',
	name: 'มุ้ง',
	base_unit: 'piece',
	distribution_type: 'one_time',
	qty_per_person: 1
};

function lot(
	itemId: string,
	qty: string,
	opts: { ref?: string; expiry?: string } = {}
): OneTimeDemandLot {
	return {
		lot_ref: opts.ref ?? `stock_ledger:${itemId}-${qty}`,
		item_id: itemId,
		unit: 'piece',
		qty,
		received_at: '2026-10-01T00:00:00.000Z',
		...(opts.expiry ? { lot: { expiry: opts.expiry } } : {})
	};
}

function build(
	items: OneTimeDemandItem[],
	people: number,
	lots: OneTimeDemandLot[] = [],
	reservations: OneTimeDemandReservation[] = []
) {
	return buildOneTimeDemandRows({ items, people, lots, reservations, now: NOW });
}

describe('buildOneTimeDemandRows', () => {
	it('120 people x 1 with 100 on hand: demand 120, shortfall 20, 83%, short', () => {
		const [row] = build([net], 120, [lot(net._id, '100')]);
		expect(row).toMatchObject({
			itemId: net._id,
			name: 'มุ้ง',
			unit: 'piece',
			demand: '120',
			available: '100',
			shortfall: '20',
			status: 'partial',
			qtyPerPersonMissing: false
		});
		expect(formatCoveragePercent(row.coverage)).toBe('83.3%');
	});

	it('qty_per_person 2 with 300 on hand: demand 240, no shortfall, enough', () => {
		const [row] = build([{ ...net, qty_per_person: 2 }], 120, [lot(net._id, '300')]);
		expect(row).toMatchObject({
			demand: '240',
			available: '300',
			shortfall: '0',
			status: 'enough'
		});
		expect(formatCoveragePercent(row.coverage)).toBe('125.0%');
	});

	it('falls back to 1 per person and flags a missing qty_per_person', () => {
		const { qty_per_person: _drop, ...noQty } = net;
		void _drop;
		const [row] = build([noQty], 120, [lot(net._id, '120')]);
		expect(row).toMatchObject({ demand: '120', qtyPerPersonMissing: true, status: 'enough' });
	});

	it('treats qty_per_person 0 as not set', () => {
		const [row] = build([{ ...net, qty_per_person: 0 }], 120, [lot(net._id, '120')]);
		expect(row).toMatchObject({ demand: '120', qtyPerPersonMissing: true, status: 'enough' });
	});

	it('applies shelf_life_days to lots without an expiry (received 2026-10-01, 30 days)', () => {
		const shelfItem = { ...net, shelf_life_days: 30 };
		const rows = build([shelfItem], 10, [
			// received 2026-10-01 + 30d = 2026-10-31 < now -> expired
			lot(net._id, '40', { ref: 'stock_ledger:old' }),
			{
				...lot(net._id, '7', { ref: 'stock_ledger:fresh' }),
				received_at: '2026-10-20T00:00:00.000Z'
			}
		]);
		expect(rows[0].available).toBe('7');
		expect(rows[0].shortfall).toBe('3');
	});

	it('does not flag an item that has a qty_per_person', () => {
		const [row] = build([net], 10);
		expect(row.qtyPerPersonMissing).toBe(false);
	});

	it('ignores expired lots (a bare expiry date lasts the whole Bangkok day)', () => {
		const rows = build([net], 120, [
			lot(net._id, '60', { ref: 'stock_ledger:a', expiry: '2026-11-04' }),
			lot(net._id, '30', { ref: 'stock_ledger:b', expiry: '2026-11-05' }),
			lot(net._id, '10', { ref: 'stock_ledger:c' })
		]);
		expect(rows[0].available).toBe('40');
		expect(rows[0].shortfall).toBe('80');
	});

	it('subtracts active reservations of counted lots', () => {
		const [row] = build(
			[net],
			120,
			[lot(net._id, '100', { ref: 'stock_ledger:a' })],
			[{ item_id: net._id, lot_ref: 'stock_ledger:a', qty: '30' }]
		);
		expect(row.available).toBe('70');
		expect(row.shortfall).toBe('50');
	});

	it('does not subtract a reservation held on an expired lot', () => {
		const [row] = build(
			[net],
			10,
			[
				lot(net._id, '50', { ref: 'stock_ledger:old', expiry: '2026-11-01' }),
				lot(net._id, '20', { ref: 'stock_ledger:new' })
			],
			[{ item_id: net._id, lot_ref: 'stock_ledger:old', qty: '5' }]
		);
		expect(row.available).toBe('20');
	});

	it('floors available at 0 when reservations exceed the balance', () => {
		const [row] = build(
			[net],
			10,
			[lot(net._id, '5', { ref: 'stock_ledger:a' })],
			[{ item_id: net._id, lot_ref: 'stock_ledger:a', qty: '8' }]
		);
		expect(row.available).toBe('0');
		expect(row.shortfall).toBe('10');
		expect(formatCoveragePercent(row.coverage)).toBe('0.0%');
	});

	it('AC-5a: lot A 50 and lot B -10 gives 50', () => {
		const [row] = build([net], 100, [
			lot(net._id, '50', { ref: 'stock_ledger:a' }),
			lot(net._id, '-10', { ref: 'stock_ledger:b' })
		]);
		expect(row.available).toBe('50');
		expect(row.shortfall).toBe('50');
	});

	it('ignores negative lots instead of subtracting them', () => {
		const [row] = build([net], 10, [
			lot(net._id, '12', { ref: 'stock_ledger:a' }),
			lot(net._id, '-4', { ref: 'stock_ledger:b' })
		]);
		expect(row.available).toBe('12');
	});

	it('a short row never rounds up to 100%', () => {
		const [row] = build([net], 1000, [lot(net._id, '997')]);
		expect(row.status).toBe('partial');
		expect(formatCoveragePercent(row.coverage)).toBe('99.7%');
		const [tiny] = build([net], 100000, [lot(net._id, '99999')]);
		expect(tiny.status).toBe('partial');
		expect(formatCoveragePercent(tiny.coverage)).toBe('99.9%');
	});

	it('0 people: demand 0, coverage is a dash, still enough', () => {
		const [row] = build([net], 0, [lot(net._id, '5')]);
		expect(row).toMatchObject({ demand: '0', shortfall: '0', coverage: null, status: 'enough' });
		expect(formatCoveragePercent(row.coverage)).toBe('—');
	});

	it('keeps decimal quantities exact (no float drift)', () => {
		const [row] = build([{ ...net, qty_per_person: 0.1 }], 3, [lot(net._id, '0.2')]);
		expect(row.demand).toBe('0.3');
		expect(row.shortfall).toBe('0.1');
	});

	it('only includes active one_time items', () => {
		const rows = build(
			[
				net,
				{ ...net, _id: 'item_master:rice', name: 'ข้าว', distribution_type: 'recurring' },
				{ ...net, _id: 'item_master:equip', name: 'ไม่ระบุ', distribution_type: undefined },
				{ ...net, _id: 'item_master:off', name: 'ปิด', deactivated: true },
				{
					...net,
					_id: 'item_master:merged',
					name: 'รวม',
					deactivated: true,
					merged_into: 'item_master:net'
				}
			],
			10
		);
		expect(rows.map((r) => r.itemId)).toEqual(['item_master:net']);
	});

	it('returns no rows when there is no one_time item', () => {
		expect(build([], 10)).toEqual([]);
	});
});

describe('sortOneTimeDemandRows', () => {
	const rowOf = (name: string, demand: number, available: number) =>
		build([{ ...net, _id: `item_master:${name}`, name }], demand, [
			lot(`item_master:${name}`, String(available))
		])[0];

	it('puts short rows first, then coverage ascending', () => {
		const enough = rowOf('enough', 10, 20); // 200%
		const half = rowOf('half', 10, 5); // 50%
		const none = rowOf('none', 10, 0); // 0%
		const most = rowOf('most', 10, 9); // 90%
		const sorted = sortOneTimeDemandRows([enough, most, half, none]);
		expect(sorted.map((r) => r.name)).toEqual(['none', 'half', 'most', 'enough']);
	});

	it('orders enough rows after short ones even with no demand, and does not mutate input', () => {
		const idle = build([{ ...net, name: 'idle' }], 0)[0];
		const short = rowOf('short', 10, 1);
		const input = [idle, short];
		expect(sortOneTimeDemandRows(input).map((r) => r.name)).toEqual(['short', 'idle']);
		expect(input[0].name).toBe('idle');
	});

	it('breaks ties by name', () => {
		const b = rowOf('b', 10, 5);
		const a = rowOf('a', 10, 5);
		expect(sortOneTimeDemandRows([b, a]).map((r) => r.name)).toEqual(['a', 'b']);
	});
});

describe('oneTimeItemIds', () => {
	it('lists only active one_time items', () => {
		expect(
			oneTimeItemIds([
				net,
				{ ...net, _id: 'item_master:rice', distribution_type: 'recurring' },
				{ ...net, _id: 'item_master:off', deactivated: true },
				{ ...net, _id: 'item_master:merged', merged_into: 'item_master:net' }
			])
		).toEqual(['item_master:net']);
	});
});

describe('already received', () => {
	const withReceived = (people: number, onHand: string, received: number) =>
		buildOneTimeDemandRows({
			items: [net],
			people,
			lots: [lot(net._id, onHand)],
			reservations: [],
			receivedByItem: new Map([[net._id, { evacuees: received, staff: 0, volunteers: 0 }]]),
			now: NOW
		})[0];

	it('120 people, 30 already served, 50 on hand: still need 90, short 40', () => {
		expect(withReceived(120, '50', 30)).toMatchObject({
			received: 30,
			demand: '90',
			available: '50',
			shortfall: '40',
			status: 'partial'
		});
	});

	it('keeps the split by kind of person on the row', () => {
		expect(withReceived(120, '50', 30).receivedBreakdown).toEqual({
			evacuees: 30,
			staff: 0,
			volunteers: 0
		});
	});

	it('everyone served: nothing left to hand out, enough', () => {
		expect(withReceived(10, '0', 10)).toMatchObject({
			demand: '0',
			shortfall: '0',
			status: 'enough'
		});
	});

	it('never goes below zero when more recipients than people are reported', () => {
		expect(withReceived(10, '0', 25)).toMatchObject({ received: 10, demand: '0' });
	});

	it('scales the rest by qty_per_person', () => {
		const [row] = buildOneTimeDemandRows({
			items: [{ ...net, qty_per_person: 2 }],
			people: 10,
			lots: [lot(net._id, '5')],
			reservations: [],
			receivedByItem: new Map([[net._id, { evacuees: 3, staff: 1, volunteers: 0 }]]),
			now: NOW
		});
		expect(row).toMatchObject({ demand: '12', shortfall: '7' });
	});
});

describe('countCurrentRecipients', () => {
	const present = presentRecipientKeys({
		evacueeIds: ['evacuee:a', 'evacuee:b'],
		volunteers: [{ id: 'volunteer:v1' }, { id: 'volunteer:v2', userName: 'alice' }],
		staffNames: ['bob']
	});

	it('counts each person once per item and only those still counted in the shelter', () => {
		const counts = countCurrentRecipients(
			[
				{ item_id: 'item_master:net', recipient_id: 'evacuee:a' },
				{ item_id: 'item_master:net', recipient_id: 'evacuee:a' },
				{ item_id: 'item_master:net', recipient_id: 'evacuee:b' },
				{ item_id: 'item_master:net', recipient_id: 'evacuee:gone' },
				{ item_id: 'item_master:tent', recipient_id: 'evacuee:a' }
			],
			present
		);
		expect(counts.get('item_master:net')).toEqual({ evacuees: 2, staff: 0, volunteers: 0 });
		expect(counts.get('item_master:tent')).toEqual({ evacuees: 1, staff: 0, volunteers: 0 });
	});

	it('counts staff and volunteers who received the item', () => {
		const counts = countCurrentRecipients(
			[
				{ item_id: 'item_master:net', recipient_id: 'user:bob' },
				{ item_id: 'item_master:net', recipient_id: 'volunteer:v1' },
				{ item_id: 'item_master:net', recipient_id: 'user:left' },
				{ item_id: 'item_master:net', recipient_id: 'volunteer:v-checked-out' }
			],
			present
		);
		expect(counts.get('item_master:net')).toEqual({ evacuees: 0, staff: 1, volunteers: 1 });
	});

	it('counts a volunteer who is also a staff account once, whichever id was recorded', () => {
		const counts = countCurrentRecipients(
			[
				{ item_id: 'item_master:net', recipient_id: 'volunteer:v2' },
				{ item_id: 'item_master:net', recipient_id: 'user:alice' }
			],
			present
		);
		expect(counts.get('item_master:net')).toEqual({ evacuees: 0, staff: 0, volunteers: 1 });
	});
});

describe('formatCoveragePercent', () => {
	it('rounds to one decimal and never shows a short row as 100%', () => {
		expect(formatCoveragePercent('63.29')).toBe('63.3%');
		expect(formatCoveragePercent('99.97')).toBe('99.9%');
		expect(formatCoveragePercent('100')).toBe('100.0%');
		expect(formatCoveragePercent('125')).toBe('125.0%');
		expect(formatCoveragePercent(null)).toBe('—');
	});
});

describe('coverageBarWidth', () => {
	it('clamps to 0-100 and is empty without demand', () => {
		expect(coverageBarWidth('63.29')).toBe(63.29);
		expect(coverageBarWidth('15658')).toBe(100);
		expect(coverageBarWidth(null)).toBe(0);
	});
});

describe('demand status tiers', () => {
	const statusOf = (people: number, onHand: string) =>
		buildOneTimeDemandRows({
			items: [net],
			people,
			lots: [lot(net._id, onHand)],
			reservations: [],
			now: NOW
		})[0].status;

	it('is enough at 100% or more, partial from 50%, shortage below', () => {
		expect(statusOf(100, '100')).toBe('enough');
		expect(statusOf(100, '99')).toBe('partial');
		expect(statusOf(100, '50')).toBe('partial');
		expect(statusOf(100, '49')).toBe('shortage');
		expect(statusOf(100, '0')).toBe('shortage');
	});

	it('counts an item nobody still needs as enough', () => {
		expect(statusOf(0, '0')).toBe('enough');
	});
});
