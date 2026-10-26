import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	buildCycleCountLots,
	classifyCycleCount,
	createCycleCountEntries,
	cycleCountVariance,
	deriveCycleCountLineId,
	groupLotsByStorage,
	planCycleCount,
	summarizeCycleCount,
	type CycleCountEntry
} from './cycle-count';
import {
	createStockLedger,
	projectStockLotBalances,
	stockBalance,
	type StockLedger,
	type StockLot
} from './operations';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'counter' };

function receive(item_id: string, qty: string, lot?: StockLot): StockLedger {
	return createStockLedger(
		{
			item_id,
			qty,
			unit: 'kg',
			reason: 'donation',
			ref_id: 'donation:d1',
			...(lot ? { lot } : {})
		},
		ctx
	);
}

const POINT_A: StockLot = { storage_point_id: 'sp-a', storage_zone: 'ชั้น A' };
const POINT_B: StockLot = { storage_point_id: 'sp-b', storage_zone: 'ห้องเย็น' };

/** An outbound row as later workflows write it: no `lot` of its own, sometimes no `lot_ref`. */
function outbound(
	from: StockLedger,
	qty: string,
	extra: Partial<StockLedger> = {},
	id = `stock_ledger:OUT${qty.replace('-', '')}`
): StockLedger {
	return {
		...from,
		_id: id,
		qty,
		reason: 'distribute',
		lot: undefined,
		lot_ref: undefined,
		occurred_at: '2099-01-01T00:00:00.000Z',
		...extra
	};
}

function entry(overrides: Partial<CycleCountEntry> = {}): CycleCountEntry {
	return {
		lot_key: 'stock_ledger:LOTA',
		lot_ref: 'stock_ledger:LOTA',
		received_at: '2026-10-01T00:00:00.000Z',
		item_id: 'item:rice',
		unit: 'kg',
		storage_key: 'id:sp-a',
		lot: POINT_A,
		system_qty: '10',
		counted_qty: '',
		...overrides
	};
}

describe('buildCycleCountLots', () => {
	it('lists each physical lot on its own, with the location and expiry it came in with', () => {
		const { lots } = buildCycleCountLots([
			receive('item:rice', '10', { ...POINT_A, expiry: '2027-01-01' }),
			receive('item:rice', '5', { ...POINT_A, expiry: '2027-01-01' }),
			receive('item:rice', '3', POINT_B)
		]);
		expect(lots).toHaveLength(3);
		expect(
			lots
				.filter((l) => l.lot.expiry === '2027-01-01')
				.map((l) => l.system_qty)
				.sort()
		).toEqual(['10', '5']);
		expect(
			lots.every((l) => l.lot_key === l.lot_ref && l.lot_ref.startsWith('stock_ledger:'))
		).toBe(true);
	});

	it('drops lots that are empty — nothing on the shelf to count', () => {
		const rice = receive('item:rice', '10', POINT_A);
		const { lots } = buildCycleCountLots([
			rice,
			outbound(rice, '-10', { lot_ref: rice._id }),
			receive('item:oil', '2', POINT_B)
		]);
		expect(lots.map((l) => l.item_id)).toEqual(['item:oil']);
	});

	it('sums a lot to the same balance the ledger reports', () => {
		const rice = receive('item:rice', '10', POINT_A);
		const ledger = [rice, outbound(rice, '-3')];
		const [lot] = buildCycleCountLots(ledger).lots;
		expect(lot.system_qty).toBe(stockBalance(ledger).get('item:rice'));
	});
});

describe('buildCycleCountLots — the stock table balance (#569)', () => {
	const water = receive('item:water', '1200', { expiry: '2027-03-01' });

	it('counts a dispatch that only names its lot (lot_ref, no lot): 1199, as the stock table does', () => {
		const ledger = [water, outbound(water, '-1', { lot_ref: water._id })];
		const { lots } = buildCycleCountLots(ledger);
		expect(lots).toHaveLength(1);
		expect(lots[0]).toMatchObject({ lot_ref: water._id, system_qty: '1199' });
		const [table] = projectStockLotBalances(ledger);
		expect(lots[0].system_qty).toBe(table.qty);
	});

	it('counts a transfer_out with no lot_ref the same way the stock table does', () => {
		const ledger = [water, outbound(water, '-7', { reason: 'transfer_out' })];
		const [lot] = buildCycleCountLots(ledger).lots;
		expect(lot.system_qty).toBe('1193');
		expect(lot.system_qty).toBe(projectStockLotBalances(ledger)[0].qty);
	});

	it('does not turn a distribution destination in lot.note into a storage group', () => {
		const ledger = [
			water,
			outbound(water, '-1', { lot_ref: water._id, lot: { note: 'อาคารยิมเนเซียม 1' } })
		];
		const { lots } = buildCycleCountLots(ledger);
		expect(lots).toHaveLength(1);
		expect(groupLotsByStorage(lots).map((g) => g.label)).toEqual(['คลังหลัก']);
	});

	it('records nothing when the shelf matches the stock table (1199)', () => {
		const ledger = [water, outbound(water, '-1', { lot_ref: water._id })];
		const entries = buildCycleCountLots(ledger).lots.map((lot) => ({
			...lot,
			counted_qty: '1199'
		}));
		expect(planCycleCount(entries, 'count-1').lines).toEqual([]);
	});

	it('skips only the item whose history cannot be replayed, and says which', () => {
		const broken = receive('item:salt', '1', POINT_A);
		const { lots, brokenItemIds } = buildCycleCountLots([
			water,
			broken,
			outbound(broken, '-5', { lot_ref: broken._id })
		]);
		expect(lots.map((l) => l.item_id)).toEqual(['item:water']);
		expect(brokenItemIds).toEqual(['item:salt']);
	});
});

describe('groupLotsByStorage', () => {
	it('puts the main store first, then points by name, labelled with the current point name', () => {
		const { lots } = buildCycleCountLots([
			receive('item:rice', '1', POINT_B),
			receive('item:rice', '1'),
			receive('item:rice', '1', POINT_A)
		]);
		const groups = groupLotsByStorage(lots, [{ id: 'sp-a', name: 'ชั้น A (เปลี่ยนชื่อ)' }]);
		expect(groups.map((g) => g.label)).toEqual(['คลังหลัก', 'ชั้น A (เปลี่ยนชื่อ)', 'ห้องเย็น']);
		expect(groups[0].storage_key).toBe('');
	});
});

describe('classifyCycleCount / cycleCountVariance', () => {
	it.each([
		['', 'uncounted', null],
		['  ', 'uncounted', null],
		['abc', 'invalid', null],
		['-1', 'invalid', null],
		['1.23456', 'invalid', null],
		['10', 'match', '0'],
		['10.0', 'match', '0'],
		['8', 'short', '-2'],
		['12.5', 'over', '2.5'],
		['0', 'short', '-10']
	])('counted %j → %s', (counted, state, variance) => {
		const e = entry({ counted_qty: counted });
		expect(classifyCycleCount(e)).toBe(state);
		expect(cycleCountVariance(e)).toBe(variance);
	});
});

describe('summarizeCycleCount', () => {
	it('tallies counted / matching / mismatched / blank / invalid lines', () => {
		const summary = summarizeCycleCount([
			entry({ counted_qty: '10' }),
			entry({ lot_key: 'b', counted_qty: '9' }),
			entry({ lot_key: 'c', counted_qty: '' }),
			entry({ lot_key: 'd', counted_qty: 'x' })
		]);
		expect(summary).toEqual({
			total: 4,
			counted: 2,
			match: 1,
			mismatched: 1,
			uncounted: 1,
			invalid: 1
		});
	});
});

describe('planCycleCount', () => {
	it('keeps only the lots that differ, with signed deltas', () => {
		const plan = planCycleCount(
			[
				entry({ lot_key: 'a', counted_qty: '10' }),
				entry({ lot_key: 'b', item_id: 'item:oil', counted_qty: '7' }),
				entry({ lot_key: 'c', item_id: 'item:salt', system_qty: '4', counted_qty: '6' }),
				entry({ lot_key: 'd', item_id: 'item:tea', counted_qty: '' })
			],
			'count-1'
		);
		expect(plan.lines.map((l) => [l.item_id, l.qty])).toEqual([
			['item:oil', '-3'],
			['item:salt', '2']
		]);
	});

	it('is empty when everything matches, and trims the note', () => {
		const plan = planCycleCount([entry({ counted_qty: '10' })], 'count-1', '  ');
		expect(plan.lines).toEqual([]);
		expect(plan.note).toBeUndefined();
		expect(planCycleCount([], 'count-1', '  รอบเช้า ').note).toBe('รอบเช้า');
	});
});

describe('createCycleCountEntries (CR-143 §C)', () => {
	const plan = planCycleCount(
		[
			entry({ lot_key: 'a', counted_qty: '7' }),
			entry({ lot_key: 'b', item_id: 'item:oil', system_qty: '2', counted_qty: '3' })
		],
		'count-1',
		'รอบเช้า'
	);

	it('writes one adjust / count_mismatch row per lot, in the lot it counted', async () => {
		const ids = await Promise.all(
			plan.lines.map((l) => deriveCycleCountLineId('count-1', l.item_id, l.lot_key))
		);
		const rows = createCycleCountEntries(plan, ctx, ids);
		expect(rows.map((r) => r._id)).toEqual(ids);
		expect(rows.every((r) => r.reason === 'adjust' && r.adjust_reason === 'count_mismatch')).toBe(
			true
		);
		expect(rows.every((r) => r.ref_id === null && r.note === 'รอบเช้า')).toBe(true);
		expect(rows.map((r) => r.qty)).toEqual(['-3', '1']);
		expect(rows[0].lot).toMatchObject({ storage_point_id: 'sp-a' });
	});

	it('takes a short count off the counted lot, and books a surplus as a new lot beside it (#569)', async () => {
		const ids = await Promise.all(
			plan.lines.map((l) => deriveCycleCountLineId('count-1', l.item_id, l.lot_key))
		);
		const [short, surplus] = createCycleCountEntries(plan, ctx, ids);
		expect(short.lot_ref).toBe('stock_ledger:LOTA');
		// A positive row is always its own lot; it keeps the counted lot's place and expiry.
		expect(surplus.lot_ref).toBe(surplus._id);
		expect(surplus.lot).toMatchObject({ storage_point_id: 'sp-a' });
	});

	it('refuses ids that do not line up with the lines', () => {
		expect(() => createCycleCountEntries(plan, ctx, [])).toThrow();
	});

	it('derives the same id for the same (count, item, lot) and different ids otherwise', async () => {
		const a = await deriveCycleCountLineId('count-1', 'item:rice', 'k');
		expect(await deriveCycleCountLineId('count-1', 'item:rice', 'k')).toBe(a);
		expect(await deriveCycleCountLineId('count-2', 'item:rice', 'k')).not.toBe(a);
		expect(await deriveCycleCountLineId('count-1', 'item:rice', 'other')).not.toBe(a);
		expect(a).toMatch(/^stock_ledger:[0-9A-HJKMNP-TV-Z]{26}$/);
	});
});
