/**
 * Generic time-series shapes for the resource-shortage trend chart (T-32.4).
 * Pure types — live in domain so both the chart UI and the resource-calc
 * snapshot can depend on them without inverting the layer direction.
 */

/** One day in a category's shortage series. `gap = max(need - have, 0)`. */
export interface TrendPoint {
	/** ISO calendar date `YYYY-MM-DD` (sorted ascending by the caller). */
	date: string;
	/** Shortage quantity for that day (already clamped to >= 0). */
	gap: number;
}

/** A shortage trend line — one per resource category (อาหาร / ของใช้ / อาสา). */
export interface TrendSeries {
	/** Stable category key, e.g. `food`. Used as the `{#each}` key. */
	key: string;
	/** Display label, e.g. `อาหาร`. */
	label: string;
	/** CSS color; defaults to a theme `--chart-*` token by index when omitted. */
	color?: string;
	points: TrendPoint[];
}
