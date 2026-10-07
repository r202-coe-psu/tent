import { describe, expect, it } from 'vitest';
import {
	HORIZON_DAYS,
	URGENT_DAYS,
	W_AGE,
	W_EXPIRY,
	isLotExpired,
	lotPriorityReason,
	rankLotsForIssue,
	scoreLot,
	type LotPriorityItem
} from './lot-priority';
import type { StockLotBalance } from './operations';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function lot(
	lotRef: string,
	opts: { ageDays?: number; expiresInDays?: number; qty?: string; produced?: number } = {}
): StockLotBalance {
	const { ageDays = 0, expiresInDays, qty = '10', produced } = opts;
	return {
		lot_ref: lotRef,
		item_id: 'item_master:x',
		unit: 'ชิ้น',
		qty,
		received_at: at(-ageDays),
		...(expiresInDays !== undefined || produced !== undefined
			? {
					lot: {
						...(expiresInDays !== undefined ? { expiry: at(expiresInDays) } : {}),
						...(produced !== undefined ? { produced_at: at(-produced) } : {})
					}
				}
			: {})
	};
}

const DRY: LotPriorityItem = { storage_type: 'DRY' };
const items = new Map<string, LotPriorityItem>([['item_master:x', DRY]]);

describe('lot-priority defaults (FR-A2)', () => {
	it('exposes the agreed weights and horizons', () => {
		expect(W_EXPIRY).toBe(1);
		expect(W_AGE).toBe(0.5);
		expect(URGENT_DAYS).toBe(7);
		expect(HORIZON_DAYS).toEqual({ DRY: 365, CHILLED: 7, FROZEN: 90, CONTROLLED_MED: 365 });
	});
});

describe('scoreLot (FR-A1)', () => {
	it('AC-A1/A2 reference numbers: A=270, B=309, C=65, D=397.5', () => {
		const a = scoreLot(lot('A', { ageDays: 60, expiresInDays: 300 }), DRY, NOW);
		const b = scoreLot(lot('B', { ageDays: 2, expiresInDays: 310 }), DRY, NOW);
		const c = scoreLot(lot('C', { ageDays: 200 }), DRY, NOW);
		const d = scoreLot(lot('D', { ageDays: 5, expiresInDays: 400 }), DRY, NOW);
		expect(a.score).toBeCloseTo(270, 6);
		expect(b.score).toBeCloseTo(309, 6);
		expect(c.score).toBeCloseTo(65, 6);
		expect(d.score).toBeCloseTo(397.5, 6);
	});

	it('uses produced_at over received_at for ageDays', () => {
		const s = scoreLot(lot('P', { ageDays: 10, produced: 40 }), DRY, NOW);
		expect(s.ageDays).toBeCloseTo(40, 6);
	});

	it('daysLeft comes from lot.expiry first, then shelf_life_days, then HORIZON', () => {
		const withExpiry = scoreLot(
			lot('a', { ageDays: 10, expiresInDays: 20 }),
			{ shelf_life_days: 100 },
			NOW
		);
		expect(withExpiry).toMatchObject({ daysLeftSource: 'expiry' });
		expect(withExpiry.daysLeft).toBeCloseTo(20, 6);

		const withShelf = scoreLot(
			lot('b', { ageDays: 10 }),
			{ shelf_life_days: 100, storage_type: 'DRY' },
			NOW
		);
		expect(withShelf).toMatchObject({ daysLeftSource: 'shelf_life' });
		expect(withShelf.daysLeft).toBeCloseTo(90, 6);

		const horizon = scoreLot(lot('c', { ageDays: 10 }), { storage_type: 'CHILLED' }, NOW);
		expect(horizon).toMatchObject({ daysLeftSource: 'horizon' });
		expect(horizon.daysLeft).toBeCloseTo(-3, 6);
	});

	it('falls back to a 365-day horizon for an unknown storage_type or missing item', () => {
		expect(scoreLot(lot('a', { ageDays: 65 }), undefined, NOW).daysLeft).toBeCloseTo(300, 6);
		expect(
			scoreLot(lot('a', { ageDays: 65 }), { storage_type: 'WEIRD' }, NOW).daysLeft
		).toBeCloseTo(300, 6);
	});

	it('ignores an unparseable expiry and falls through to the next source', () => {
		const l = lot('a', { ageDays: 1 });
		l.lot = { expiry: 'not-a-date' };
		expect(scoreLot(l, DRY, NOW).daysLeftSource).toBe('horizon');
	});
});

describe('urgent group (FR-A3, FR-A3a)', () => {
	it('AC-A3: expiring in 3 days outranks 365-day-old DRY stock without expiry', () => {
		const e = lot('E', { ageDays: 30, expiresInDays: 3 });
		const f = lot('F', { ageDays: 365 });
		expect(scoreLot(e, DRY, NOW).score).toBeCloseTo(-12, 6);
		expect(scoreLot(f, DRY, NOW).score).toBeCloseTo(-182.5, 6);
		expect(scoreLot(e, DRY, NOW).isUrgent).toBe(true);
		expect(scoreLot(f, DRY, NOW).isUrgent).toBe(false);
		expect(rankLotsForIssue([f, e], items, NOW).map((l) => l.lot_ref)).toEqual(['E', 'F']);
	});

	it('AC-A3b: HORIZON-derived daysLeft of 5 is not urgent', () => {
		const s = scoreLot(lot('G', { ageDays: 360 }), DRY, NOW);
		expect(s.daysLeft).toBeCloseTo(5, 6);
		expect(s.isUrgent).toBe(false);
	});

	it('shelf_life_days-derived daysLeft counts as real data', () => {
		const s = scoreLot(lot('S', { ageDays: 1 }), { shelf_life_days: 5 }, NOW);
		expect(s.daysLeft).toBeCloseTo(4, 6);
		expect(s.isUrgent).toBe(true);
	});

	it('daysLeft exactly URGENT_DAYS is urgent; just above is not', () => {
		expect(scoreLot(lot('a', { expiresInDays: 7 }), DRY, NOW).isUrgent).toBe(true);
		expect(scoreLot(lot('b', { expiresInDays: 7.5 }), DRY, NOW).isUrgent).toBe(false);
	});

	it('orders the urgent group by daysLeft, then the rest by score', () => {
		const ranked = rankLotsForIssue(
			[
				lot('rest-high', { ageDays: 1, expiresInDays: 400 }),
				lot('urgent-6', { ageDays: 100, expiresInDays: 6 }),
				lot('rest-low', { ageDays: 300, expiresInDays: 200 }),
				lot('urgent-2', { ageDays: 1, expiresInDays: 2 })
			],
			items,
			NOW
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['urgent-2', 'urgent-6', 'rest-low', 'rest-high']);
	});
});

describe('rankLotsForIssue (FR-A3)', () => {
	it('AC-A1: A (300 days left, 60 in stock) before B (310 left, 2 in stock)', () => {
		const ranked = rankLotsForIssue(
			[lot('B', { ageDays: 2, expiresInDays: 310 }), lot('A', { ageDays: 60, expiresInDays: 300 })],
			items,
			NOW
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['A', 'B']);
	});

	it('AC-A2: C (no expiry, DRY, 200 days in stock) before D (400 days left, 5 in stock)', () => {
		const ranked = rankLotsForIssue(
			[lot('D', { ageDays: 5, expiresInDays: 400 }), lot('C', { ageDays: 200 })],
			items,
			NOW
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['C', 'D']);
	});

	it('breaks score ties by older received_at, then lot_ref', () => {
		// produced_at pins ageDays, so equal scores can carry different received_at
		const mk = (ref: string, receivedAgo: number): StockLotBalance => ({
			...lot(ref, { ageDays: receivedAgo, expiresInDays: 100, produced: 10 })
		});
		const ranked = rankLotsForIssue(
			[mk('late', 2), mk('b', 5), mk('a', 5), mk('early', 9)],
			items,
			NOW
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['early', 'a', 'b', 'late']);
	});

	it('drops lots with no quantity left', () => {
		const ranked = rankLotsForIssue(
			[lot('empty', { qty: '0' }), lot('left', { qty: '3' })],
			items,
			NOW
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['left']);
	});

	it('does not mutate its input', () => {
		const input = [lot('b', { ageDays: 1 }), lot('a', { ageDays: 300 })];
		const copy = [...input];
		rankLotsForIssue(input, items, NOW);
		expect(input).toEqual(copy);
	});

	it('resolves each lot against its own item', () => {
		const chilled: StockLotBalance = {
			...lot('milk', { ageDays: 6 }),
			item_id: 'item_master:milk'
		};
		const rice: StockLotBalance = { ...lot('rice', { ageDays: 6 }), item_id: 'item_master:rice' };
		const map = new Map<string, LotPriorityItem>([
			['item_master:milk', { storage_type: 'CHILLED' }],
			['item_master:rice', { storage_type: 'DRY' }]
		]);
		// milk: 7 - 6 - 3 = -2 (horizon); rice: 365 - 6 - 3 = 356
		expect(rankLotsForIssue([rice, chilled], map, NOW).map((l) => l.lot_ref)).toEqual([
			'milk',
			'rice'
		]);
	});

	it('works without an items map (unknown item => 365-day horizon)', () => {
		const ranked = rankLotsForIssue(
			[lot('new', { ageDays: 1 }), lot('old', { ageDays: 100 })],
			undefined,
			NOW
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['old', 'new']);
	});
});

describe('expired lots (FR-A4, AC-A4)', () => {
	it('isLotExpired is true when lot.expiry <= now', () => {
		expect(isLotExpired(lot('a', { expiresInDays: -1 }), NOW)).toBe(true);
		expect(isLotExpired(lot('a', { expiresInDays: 0 }), NOW)).toBe(true);
		expect(isLotExpired(lot('a', { expiresInDays: 1 }), NOW)).toBe(false);
		expect(isLotExpired(lot('a'), NOW)).toBe(false);
	});

	it('ranks an expired lot after every usable lot', () => {
		const ranked = rankLotsForIssue(
			[
				lot('expired', { ageDays: 40, expiresInDays: -2 }),
				lot('fresh', { ageDays: 1, expiresInDays: 300 })
			],
			items,
			NOW
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['fresh', 'expired']);
	});

	it('excludeExpired removes expired lots from the auto-issue order', () => {
		const ranked = rankLotsForIssue(
			[lot('expired', { expiresInDays: -2 }), lot('fresh', { expiresInDays: 300 })],
			items,
			NOW,
			{ excludeExpired: true }
		);
		expect(ranked.map((l) => l.lot_ref)).toEqual(['fresh']);
	});
});

describe('lotPriorityReason (FR-A6)', () => {
	it('urgent lot: days until expiry', () => {
		expect(lotPriorityReason(lot('a', { ageDays: 30, expiresInDays: 3 }), DRY, NOW)).toBe(
			'หมดอายุอีก 3 วัน (เร่งด่วน)'
		);
	});

	it('no real expiry: days in stock', () => {
		expect(lotPriorityReason(lot('a', { ageDays: 200 }), DRY, NOW)).toBe('อยู่ในคลัง 200 วัน');
	});

	it('just received lot without expiry', () => {
		expect(lotPriorityReason(lot('a'), DRY, NOW)).toBe('เพิ่งรับเข้า');
	});

	it('non-urgent lot with expiry: expiry and days in stock', () => {
		expect(lotPriorityReason(lot('a', { ageDays: 60, expiresInDays: 300 }), DRY, NOW)).toBe(
			'หมดอายุอีก 300 วัน · อยู่ในคลัง 60 วัน'
		);
	});

	it('shelf-life derived daysLeft is labelled as shelf life', () => {
		expect(lotPriorityReason(lot('a', { ageDays: 10 }), { shelf_life_days: 100 }, NOW)).toBe(
			'อายุเก็บรักษาเหลือ 90 วัน · อยู่ในคลัง 10 วัน'
		);
	});

	it('expired lot asks for adjustment', () => {
		expect(lotPriorityReason(lot('a', { expiresInDays: -2 }), DRY, NOW)).toBe(
			'หมดอายุแล้ว — ปรับยอดออก'
		);
	});
});

describe('lot past its shelf life (FR-A4a-c, AC-A7, AC-A8)', () => {
	const SHELF: LotPriorityItem = { storage_type: 'DRY', shelf_life_days: 30 };
	const shelfItems = new Map<string, LotPriorityItem>([['item_master:x', SHELF]]);

	it('AC-A7: shelf life 30d, 60d in stock, no expiry is expired', () => {
		const stale = lot('stale', { ageDays: 60 });
		expect(isLotExpired(stale, NOW, SHELF)).toBe(true);
		const s = scoreLot(stale, SHELF, NOW);
		expect(s.isExpired).toBe(true);
		expect(s.isUrgent).toBe(false);
	});

	it('AC-A7: not auto-selected and ranked after a lot expiring in 3 days', () => {
		const lots = [lot('stale', { ageDays: 60 }), lot('soon', { ageDays: 5, expiresInDays: 3 })];
		expect(rankLotsForIssue(lots, shelfItems, NOW).map((l) => l.lot_ref)).toEqual([
			'soon',
			'stale'
		]);
		expect(
			rankLotsForIssue(lots, shelfItems, NOW, { excludeExpired: true }).map((l) => l.lot_ref)
		).toEqual(['soon']);
	});

	it('AC-A7: UI reason tells staff to adjust it out', () => {
		expect(lotPriorityReason(lot('stale', { ageDays: 60 }), SHELF, NOW)).toBe(
			'หมดอายุแล้ว — ปรับยอดออก'
		);
	});

	it('FR-A4a: daysLeft exactly 0 from shelf life is expired', () => {
		expect(scoreLot(lot('a', { ageDays: 30 }), SHELF, NOW).isExpired).toBe(true);
	});

	it('FR-A4b: isUrgent only when 0 < daysLeft <= URGENT_DAYS', () => {
		expect(scoreLot(lot('a', { ageDays: 25 }), SHELF, NOW).isUrgent).toBe(true);
		expect(scoreLot(lot('a', { ageDays: 30 }), SHELF, NOW).isUrgent).toBe(false);
		expect(scoreLot(lot('a', { expiresInDays: 0.5 }), DRY, NOW).isUrgent).toBe(true);
	});

	it('a real expiry wins over shelf life', () => {
		expect(isLotExpired(lot('a', { ageDays: 60, expiresInDays: 10 }), NOW, SHELF)).toBe(false);
	});

	it('AC-A8: DRY, no expiry, no shelf life, 400d in stock stays selectable', () => {
		const old = lot('old', { ageDays: 400 });
		expect(isLotExpired(old, NOW, DRY)).toBe(false);
		expect(isLotExpired(old, NOW)).toBe(false);
		const s = scoreLot(old, DRY, NOW);
		expect(s.daysLeft).toBeLessThan(0);
		expect(s.isExpired).toBe(false);
		expect(s.isUrgent).toBe(false);
		expect(rankLotsForIssue([old], items, NOW, { excludeExpired: true })).toHaveLength(1);
	});

	it('reason and isUrgent agree on a fractional daysLeft', () => {
		// 0.5 days left: urgent, and the reason must not claim it is already past shelf life
		const l = lot('a', { ageDays: 29.5 });
		expect(scoreLot(l, SHELF, NOW).isUrgent).toBe(true);
		expect(lotPriorityReason(l, SHELF, NOW)).toContain('(เร่งด่วน)');
		expect(lotPriorityReason(l, SHELF, NOW)).not.toContain('เกินอายุ');
	});
});
