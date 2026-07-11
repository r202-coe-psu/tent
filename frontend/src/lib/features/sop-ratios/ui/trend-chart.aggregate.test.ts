import { describe, it, expect } from 'vitest';
import {
	capSeries,
	downsamplePoints,
	formatDayLabel,
	MAX_TREND_ROWS,
	pickTickIndices,
	seriesMax,
	wasAggregated,
	type TrendPoint,
	type TrendSeries
} from './trend-chart.aggregate';

const pts = (gaps: number[]): TrendPoint[] =>
	gaps.map((gap, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, gap }));

describe('downsamplePoints', () => {
	it('returns the input unchanged when within the cap', () => {
		const input = pts([1, 2, 3]);
		expect(downsamplePoints(input, 500)).toBe(input);
	});

	it('caps a series above 500 rows to at most 500 points', () => {
		const input = pts(Array.from({ length: 1234 }, (_, i) => i));
		const out = downsamplePoints(input, MAX_TREND_ROWS);
		expect(out.length).toBeLessThanOrEqual(MAX_TREND_ROWS);
		expect(out.length).toBeGreaterThan(0);
	});

	it('averages each bucket and labels it with the bucket start date', () => {
		// 4 points, cap 2 -> bucketSize 2 -> averages [10,20]=15 and [30,40]=35
		const out = downsamplePoints(pts([10, 20, 30, 40]), 2);
		expect(out).toEqual([
			{ date: '2026-06-01', gap: 15 },
			{ date: '2026-06-03', gap: 35 }
		]);
	});

	it('rounds averaged gaps to 2 decimals', () => {
		const out = downsamplePoints(pts([1, 2]), 1);
		expect(out[0].gap).toBe(1.5);
	});

	it('returns empty for a non-positive cap', () => {
		expect(downsamplePoints(pts([1, 2]), 0)).toEqual([]);
	});
});

describe('capSeries / wasAggregated', () => {
	const big: TrendSeries[] = [{ key: 'food', label: 'อาหาร', points: pts(Array(600).fill(1)) }];
	const small: TrendSeries[] = [{ key: 'food', label: 'อาหาร', points: pts([1, 2, 3]) }];

	it('flags aggregation only when a series exceeds the cap', () => {
		expect(wasAggregated(big)).toBe(true);
		expect(wasAggregated(small)).toBe(false);
	});

	it('caps every series to <= maxRows', () => {
		for (const s of capSeries(big)) expect(s.points.length).toBeLessThanOrEqual(MAX_TREND_ROWS);
	});
});

describe('seriesMax', () => {
	it('returns the largest gap across all series', () => {
		const series: TrendSeries[] = [
			{ key: 'food', label: 'อาหาร', points: pts([3, 7, 2]) },
			{ key: 'supply', label: 'ของใช้', points: pts([5, 9, 1]) }
		];
		expect(seriesMax(series)).toBe(9);
	});

	it('floors at 1 to avoid divide-by-zero on an all-zero / empty dataset', () => {
		expect(seriesMax([])).toBe(1);
		expect(seriesMax([{ key: 'x', label: 'x', points: pts([0, 0]) }])).toBe(1);
	});
});

describe('pickTickIndices', () => {
	it('returns all indices when within the tick budget', () => {
		expect(pickTickIndices(5, 7)).toEqual([0, 1, 2, 3, 4]);
	});

	it('always includes first and last and never exceeds the budget', () => {
		const ticks = pickTickIndices(100, 7);
		expect(ticks[0]).toBe(0);
		expect(ticks[ticks.length - 1]).toBe(99);
		expect(ticks.length).toBeLessThanOrEqual(7);
	});

	it('handles empty input', () => {
		expect(pickTickIndices(0)).toEqual([]);
	});
});

describe('formatDayLabel', () => {
	it('formats an ISO date as D/M without leading zeros', () => {
		expect(formatDayLabel('2026-06-07')).toBe('7/6');
		expect(formatDayLabel('2026-12-25')).toBe('25/12');
	});

	it('falls back to the raw string when malformed', () => {
		expect(formatDayLabel('nope')).toBe('nope');
	});
});
