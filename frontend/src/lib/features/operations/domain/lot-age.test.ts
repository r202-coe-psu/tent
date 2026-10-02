import { describe, expect, it } from 'vitest';
import {
	formatAgeInStock,
	formatItemAgeLine,
	formatLotClockLine,
	formatThaiDuration,
	formatTimeSinceProduced,
	formatTimeUntilExpiry,
	summarizeItemLotAge,
	timeUntilExpiryMs
} from './lot-age';
import type { StockLotBalance } from './operations';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('formatThaiDuration', () => {
	it('shows เพิ่งเข้า for under two minutes', () => {
		expect(formatThaiDuration(30_000)).toBe('เพิ่งเข้า');
		expect(formatThaiDuration(119_000)).toBe('เพิ่งเข้า');
	});

	it('formats minutes only under an hour', () => {
		expect(formatThaiDuration(5 * 60_000)).toBe('5 นาที');
	});

	it('formats hours and optional minutes', () => {
		expect(formatThaiDuration(2 * HOUR)).toBe('2 ชม.');
		expect(formatThaiDuration(2 * HOUR + 15 * 60_000)).toBe('2 ชม. 15 นาที');
	});

	it('formats days and optional hours', () => {
		expect(formatThaiDuration(DAY)).toBe('1 วัน');
		expect(formatThaiDuration(DAY + 5 * HOUR)).toBe('1 วัน 5 ชม.');
		expect(formatThaiDuration(3 * DAY)).toBe('3 วัน');
	});

	it('uses absolute value for negative input', () => {
		expect(formatThaiDuration(-(DAY + HOUR))).toBe('1 วัน 1 ชม.');
	});
});

describe('age / produced / expiry helpers', () => {
	const now = Date.parse('2026-09-26T12:00:00.000Z');

	it('formats age in stock from received_at', () => {
		expect(formatAgeInStock('2026-09-23T12:00:00.000Z', now)).toBe('3 วัน');
		expect(formatAgeInStock('2026-09-26T10:55:00.000Z', now)).toBe('1 ชม. 5 นาที');
	});

	it('formats time since produced', () => {
		expect(formatTimeSinceProduced('2026-09-24T12:00:00.000Z', now)).toBe('2 วัน');
	});

	it('formats time until expiry and expired state', () => {
		expect(formatTimeUntilExpiry('2026-10-08T12:00:00.000Z', now)).toBe('12 วัน');
		expect(formatTimeUntilExpiry('2026-09-25T12:00:00.000Z', now)).toBe('หมดแล้ว 1 วัน');
		expect(timeUntilExpiryMs('2026-09-25T12:00:00.000Z', now)).toBe(-DAY);
	});

	it('returns null for invalid timestamps', () => {
		expect(formatAgeInStock('not-a-date', now)).toBeNull();
		expect(formatTimeSinceProduced('bad', now)).toBeNull();
		expect(formatTimeUntilExpiry('bad', now)).toBeNull();
	});
});

describe('summarizeItemLotAge', () => {
	const now = Date.parse('2026-09-26T12:00:00.000Z');

	function lot(
		partial: Partial<StockLotBalance> & Pick<StockLotBalance, 'lot_ref'>
	): StockLotBalance {
		return {
			item_id: 'item:water',
			unit: 'pack',
			qty: '10',
			received_at: '2026-09-23T12:00:00.000Z',
			...partial
		};
	}

	it('picks oldest received, nearest expiry, oldest produced among remaining lots', () => {
		const summary = summarizeItemLotAge(
			[
				lot({
					lot_ref: 'stock_ledger:a',
					qty: '5',
					received_at: '2026-09-20T12:00:00.000Z',
					lot: { expiry: '2026-10-10T00:00:00.000Z', produced_at: '2026-09-18T12:00:00.000Z' }
				}),
				lot({
					lot_ref: 'stock_ledger:b',
					qty: '3',
					received_at: '2026-09-24T12:00:00.000Z',
					lot: { expiry: '2026-10-01T00:00:00.000Z', produced_at: '2026-09-22T12:00:00.000Z' }
				}),
				lot({
					lot_ref: 'stock_ledger:empty',
					qty: '0',
					received_at: '2026-09-01T12:00:00.000Z',
					lot: { expiry: '2026-09-15T00:00:00.000Z', produced_at: '2026-08-01T12:00:00.000Z' }
				})
			],
			now
		);

		expect(summary.inStock).toBe('6 วัน');
		expect(summary.untilExpiry).toBe('4 วัน 12 ชม.');
		expect(summary.sinceProduced).toBe('8 วัน');
	});

	it('omits clocks when data is missing', () => {
		expect(
			summarizeItemLotAge([lot({ lot_ref: 'stock_ledger:x', lot: { note: 'Zone A' } })], now)
		).toEqual({ inStock: '3 วัน' });
	});

	it('formats row and lot picker lines', () => {
		const summary = { inStock: '3 วัน', untilExpiry: '12 วัน', sinceProduced: '2 วัน' };
		expect(formatItemAgeLine(summary)).toBe('ในคลัง 3 วัน · หมดอายุใน 12 วัน · จากผลิต 2 วัน');

		expect(
			formatLotClockLine(
				{
					received_at: '2026-09-26T07:00:00.000Z',
					lot: {
						produced_at: '2026-09-24T12:00:00.000Z',
						expiry: '2026-10-01T12:00:00.000Z'
					}
				},
				now
			)
		).toBe('ในคลัง 5 ชม. · จากผลิต 2 วัน · หมดอายุใน 5 วัน');
	});
});
