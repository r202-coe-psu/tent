/**
 * Pure view-model helpers for the resource-shortage trend chart (T-32.4).
 *
 * No Svelte, no I/O — only the data shaping the chart needs:
 *  - the **max 500 rows** rule (downsample by bucket-averaging before render)
 *  - y-axis scaling and x-axis tick selection.
 *
 * The chart itself is presentational: a page (T-32 dashboard) feeds it the
 * already-computed per-category gap series from the T-31 calculation engine.
 */

import type { TrendPoint, TrendSeries } from '../domain/trend';

export type { TrendPoint, TrendSeries };

/** Hard cap on rendered points per series (Rule: max 500 rows, aggregate if over). */
export const MAX_TREND_ROWS = 500;

/**
 * Collapse a series to at most `maxRows` points by averaging contiguous buckets,
 * preserving the overall trend shape. Returns the input untouched when already
 * within the cap. The bucket's first date labels the aggregated point.
 */
export function downsamplePoints(
	points: TrendPoint[],
	maxRows: number = MAX_TREND_ROWS
): TrendPoint[] {
	if (maxRows < 1) return [];
	if (points.length <= maxRows) return points;

	const bucketSize = Math.ceil(points.length / maxRows);
	const out: TrendPoint[] = [];
	for (let i = 0; i < points.length; i += bucketSize) {
		const bucket = points.slice(i, i + bucketSize);
		const sum = bucket.reduce((acc, p) => acc + p.gap, 0);
		out.push({ date: bucket[0].date, gap: roundTo(sum / bucket.length, 2) });
	}
	return out;
}

/** Apply the row cap to every series. Pure — returns new series objects. */
export function capSeries(series: TrendSeries[], maxRows: number = MAX_TREND_ROWS): TrendSeries[] {
	return series.map((s) => ({ ...s, points: downsamplePoints(s.points, maxRows) }));
}

/** True when any series exceeds the cap (so the UI can flag that data was aggregated). */
export function wasAggregated(series: TrendSeries[], maxRows: number = MAX_TREND_ROWS): boolean {
	return series.some((s) => s.points.length > maxRows);
}

/** Largest gap across all series, floored at 1 so the y-axis never divides by zero. */
export function seriesMax(series: TrendSeries[]): number {
	let max = 0;
	for (const s of series) {
		for (const p of s.points) if (p.gap > max) max = p.gap;
	}
	return Math.max(max, 1);
}

/**
 * Evenly-spaced point indices to label on the x-axis, capped at `max` ticks so
 * dense series don't crowd the axis. Always includes the first and last index.
 */
export function pickTickIndices(length: number, max: number = 7): number[] {
	if (length <= 0) return [];
	if (length <= max) return Array.from({ length }, (_, i) => i);

	const step = (length - 1) / (max - 1);
	const indices = new Set<number>();
	for (let i = 0; i < max; i++) indices.add(Math.round(i * step));
	return [...indices].sort((a, b) => a - b);
}

/** Format an ISO `YYYY-MM-DD` as `D/M` without `Date` (timezone-safe). */
export function formatDayLabel(iso: string): string {
	const [, month, day] = iso.split('-');
	if (!month || !day) return iso;
	return `${Number(day)}/${Number(month)}`;
}

function roundTo(value: number, digits: number): number {
	const f = 10 ** digits;
	return Math.round(value * f) / f;
}
