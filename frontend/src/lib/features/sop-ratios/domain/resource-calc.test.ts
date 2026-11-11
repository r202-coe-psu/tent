import { describe, it, expect } from 'vitest';
import {
	computeGap,
	coverage,
	severityOf,
	sortBySeverity,
	summarizeByCategory,
	type GapRow
} from './resource-calc';

const row = (
	over: Partial<GapRow> & Pick<GapRow, 'item_id' | 'category' | 'need' | 'have'>
): GapRow => ({
	label: over.item_id,
	unit: 'หน่วย',
	gap: computeGap(over.need, over.have),
	ratio_source: 'master',
	provenance: { occupancy: 100, ratio: 1, stock: over.have, as_of: '2026-06-27T08:00:00Z' },
	...over
});

describe('computeGap', () => {
	it('is the positive shortfall and never negative', () => {
		expect(computeGap(100, 60)).toBe(40);
		expect(computeGap(50, 80)).toBe(0);
	});

	it('treats float-noisy need − have as zero', () => {
		expect(computeGap(0.1 + 0.2, 0.3)).toBe(0);
		expect(severityOf(0.1 + 0.2, 0.3)).toBe('ok');
	});
});

describe('coverage', () => {
	it('is have/need clamped to [0,1]', () => {
		expect(coverage(100, 60)).toBe(0.6);
		expect(coverage(100, 250)).toBe(1);
	});

	it('treats a zero need as fully covered (no divide-by-zero)', () => {
		expect(coverage(0, 0)).toBe(1);
	});
});

describe('severityOf', () => {
	it('is ok when nothing is short', () => {
		expect(severityOf(100, 100)).toBe('ok');
		expect(severityOf(100, 120)).toBe('ok');
	});

	it('is critical below 50% coverage, low otherwise', () => {
		expect(severityOf(100, 40)).toBe('critical');
		expect(severityOf(100, 49)).toBe('critical');
		expect(severityOf(100, 50)).toBe('low');
		expect(severityOf(100, 90)).toBe('low');
	});
});

describe('sortBySeverity', () => {
	it('orders critical → low → ok, then by lower coverage', () => {
		const rows = [
			row({ item_id: 'ok', category: 'food', need: 10, have: 10 }),
			row({ item_id: 'low', category: 'food', need: 100, have: 80 }),
			row({ item_id: 'critical-30', category: 'supply', need: 100, have: 30 }),
			row({ item_id: 'critical-10', category: 'supply', need: 100, have: 10 })
		];
		expect(sortBySeverity(rows).map((r) => r.item_id)).toEqual([
			'critical-10',
			'critical-30',
			'low',
			'ok'
		]);
	});

	it('does not mutate the input array', () => {
		const rows = [
			row({ item_id: 'a', category: 'food', need: 10, have: 1 }),
			row({ item_id: 'b', category: 'food', need: 10, have: 9 })
		];
		const snapshot = rows.map((r) => r.item_id);
		sortBySeverity(rows);
		expect(rows.map((r) => r.item_id)).toEqual(snapshot);
	});
});

describe('summarizeByCategory', () => {
	it('always returns all three categories in canonical order', () => {
		const summary = summarizeByCategory([]);
		expect(summary.map((s) => s.category)).toEqual(['food', 'supply', 'volunteer']);
		expect(summary.every((s) => s.severity === 'ok' && s.total_items === 0)).toBe(true);
	});

	it('counts short items and uses the worst coverage for severity', () => {
		const rows = [
			row({ item_id: 'rice', category: 'food', need: 100, have: 100 }),
			row({ item_id: 'water', category: 'food', need: 100, have: 20 }),
			row({ item_id: 'blanket', category: 'supply', need: 100, have: 70 })
		];
		const byCat = Object.fromEntries(summarizeByCategory(rows).map((s) => [s.category, s]));
		expect(byCat.food).toMatchObject({ total_items: 2, short_items: 1, severity: 'critical' });
		expect(byCat.supply).toMatchObject({ total_items: 1, short_items: 1, severity: 'low' });
		expect(byCat.volunteer).toMatchObject({ total_items: 0, short_items: 0, severity: 'ok' });
	});
});

describe('severity boundaries on decimal quantities (#936)', () => {
	it.each([
		{
			name: '100 need, 50 have is exactly 50% coverage (low)',
			need: 100,
			have: 50,
			severity: 'low'
		},
		{
			name: '10000 need, 4999 have is 0.4999 coverage (critical)',
			need: 10000,
			have: 4999,
			severity: 'critical'
		},
		{
			name: 'string quantities 0.3 need, 0.15 have (low)',
			need: '0.3',
			have: '0.15',
			severity: 'low'
		},
		{ name: 'float-equal need and have is ok', need: 0.3, have: 0.3, severity: 'ok' },
		{ name: 'zero need is ok', need: 0, have: 5, severity: 'ok' },
		{ name: 'surplus is ok', need: 100, have: 120, severity: 'ok' }
	])('$name', ({ need, have, severity }) => {
		expect(severityOf(need, have)).toBe(severity);
	});

	it('summarizeByCategory marks a 50% worst coverage as low with coverage 0.5', () => {
		const [food] = summarizeByCategory([
			row({ item_id: 'rice', category: 'food', need: 100, have: 50 })
		]);
		expect(food).toMatchObject({ severity: 'low', coverage: 0.5, short_items: 1 });
	});

	it('summarizeByCategory marks 4999 of 10000 as critical', () => {
		const [food] = summarizeByCategory([
			row({ item_id: 'water', category: 'food', need: 10000, have: 4999 })
		]);
		expect(food).toMatchObject({ severity: 'critical', coverage: 0.4999, short_items: 1 });
	});
});
