import { describe, expect, it } from 'vitest';
import {
	daysOfCover,
	dailyConsumption,
	deriveStockQtyStatus,
	everStockedItemIds,
	groupLotsByItem,
	resolveReorderThreshold,
	stockUrgencyRank,
	summarizeItemStock
} from './stock-summary';
import type { StockLotBalance } from './operations';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function lot(over: Partial<StockLotBalance> & { lot_ref: string }): StockLotBalance {
	return { item_id: 'item_master:water', unit: 'pack', qty: '10', received_at: iso(-1), ...over };
}

describe('summarizeItemStock', () => {
	it('uses the earliest expiry across all remaining lots, not the latest receipt', () => {
		const lots = [
			lot({ lot_ref: 'old', received_at: iso(-30), lot: { expiry: iso(2) } }),
			lot({ lot_ref: 'new', received_at: iso(-1), lot: { expiry: iso(300) } })
		];
		const s = summarizeItemStock(lots, NOW);
		expect(s.earliestExpiry).toBe(iso(2));
		expect(s.expiryState).toBe('expiring');
		expect(s.oldestReceivedAt).toBe(iso(-30));
	});

	it('ignores empty lots', () => {
		const lots = [
			lot({ lot_ref: 'gone', qty: '0', lot: { expiry: iso(-5) } }),
			lot({ lot_ref: 'live', lot: { expiry: iso(100) } })
		];
		const s = summarizeItemStock(lots, NOW);
		expect(s.lotCount).toBe(1);
		expect(s.expiryState).toBe('ok');
		expect(s.expiredQty).toBe('0');
	});

	it('flags expired stock and sums its quantity', () => {
		const lots = [
			lot({ lot_ref: 'a', qty: '12', lot: { expiry: iso(-1) } }),
			lot({ lot_ref: 'b', qty: '24', lot: { expiry: iso(200) } })
		];
		const s = summarizeItemStock(lots, NOW);
		expect(s.expiryState).toBe('expired');
		expect(s.expiredQty).toBe('12');
	});

	it('reports none when no lot carries an expiry', () => {
		expect(summarizeItemStock([lot({ lot_ref: 'a' })], NOW).expiryState).toBe('none');
		expect(summarizeItemStock([], NOW)).toMatchObject({
			earliestExpiry: null,
			lotCount: 0,
			oldestReceivedAt: null
		});
	});

	it('collects distinct storage keys', () => {
		const lots = [
			lot({ lot_ref: 'a', lot: { storage_point_id: 'p1', storage_zone: 'คลัง A' } }),
			lot({ lot_ref: 'b', lot: { storage_point_id: 'p1', storage_zone: 'คลัง A' } }),
			lot({ lot_ref: 'c' })
		];
		expect(summarizeItemStock(lots, NOW).storageKeys.sort()).toEqual(['', 'id:p1']);
	});
});

describe('groupLotsByItem', () => {
	it('groups by item id', () => {
		const grouped = groupLotsByItem([
			lot({ lot_ref: 'a', item_id: 'x' }),
			lot({ lot_ref: 'b', item_id: 'y' }),
			lot({ lot_ref: 'c', item_id: 'x' })
		]);
		expect(grouped.get('x')?.map((l) => l.lot_ref)).toEqual(['a', 'c']);
		expect(grouped.get('y')).toHaveLength(1);
	});
});

describe('resolveReorderThreshold', () => {
	const item = { consumption_rate: '3', target_reserve_days: 1, reorder_level: 50 };

	it('prefers an override rate × days', () => {
		expect(
			resolveReorderThreshold(100, item, { consumption_rate: '2', target_reserve_days: 2 })
		).toBe('400');
	});

	it('falls back to an override fixed level', () => {
		expect(resolveReorderThreshold(100, item, { reorder_level: 7 })).toBe('7');
	});

	it('uses the item rate × days, then the item fixed level', () => {
		expect(resolveReorderThreshold(100, item)).toBe('300');
		expect(resolveReorderThreshold(100, { reorder_level: 50 })).toBe('50');
	});

	it('returns null when nothing is configured', () => {
		expect(resolveReorderThreshold(100, {})).toBeNull();
		expect(
			resolveReorderThreshold(100, { reorder_level: null }, { reorder_level: null })
		).toBeNull();
	});
});

describe('dailyConsumption / daysOfCover', () => {
	it('computes occupancy × rate, divided by 7 for weekly', () => {
		expect(dailyConsumption(320, { consumption_rate: '0.125' })).toBe('40');
		expect(dailyConsumption(70, { consumption_rate: '1', timeframe: 'weekly' })).toBe('10');
	});

	it('prefers the override rate', () => {
		expect(dailyConsumption(10, { consumption_rate: '1' }, { consumption_rate: '2' })).toBe('20');
	});

	it('is unknown without a rate or occupancy', () => {
		expect(dailyConsumption(320, { reorder_level: 80 })).toBeNull();
		expect(dailyConsumption(0, { consumption_rate: '1' })).toBeNull();
		expect(daysOfCover('42', null)).toBeNull();
	});

	it('rounds days of cover down to one decimal and never goes negative', () => {
		expect(daysOfCover('42', '40')).toBe(1);
		expect(daysOfCover('60', '40')).toBe(1.5);
		expect(daysOfCover('-3', '40')).toBe(0);
	});
});

describe('deriveStockQtyStatus / stockUrgencyRank', () => {
	it('derives empty, low and normal', () => {
		expect(deriveStockQtyStatus('0', '40')).toBe('empty');
		expect(deriveStockQtyStatus('40', '40')).toBe('low');
		expect(deriveStockQtyStatus('41', '40')).toBe('normal');
		expect(deriveStockQtyStatus('5', null)).toBe('normal');
	});

	it('orders expired → empty → low → expiring → normal', () => {
		const ranks = [
			stockUrgencyRank('normal', 'ok'),
			stockUrgencyRank('normal', 'expiring'),
			stockUrgencyRank('low', 'none'),
			stockUrgencyRank('empty', 'none'),
			stockUrgencyRank('normal', 'expired')
		];
		expect(ranks).toEqual([4, 3, 2, 1, 0]);
		expect(stockUrgencyRank('low', 'expired')).toBe(0);
	});
});

describe('everStockedItemIds', () => {
	it('collects item ids seen in the ledger', () => {
		const ids = everStockedItemIds([{ item_id: 'a' }, { item_id: 'b' }, { item_id: 'a' }]);
		expect([...ids].sort()).toEqual(['a', 'b']);
	});
});
