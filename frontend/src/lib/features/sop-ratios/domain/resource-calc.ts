/**
 * Resource calculation read-model (T-32 / FR-46) — what the dashboard renders.
 *
 * The numbers are produced by the T-31 daily calc engine (FR-45):
 *   need  = occupancy × effective ratio   (effective = shelter override ?? master, CR-006)
 *   have  = stock_balance / available volunteers
 *   gap   = max(need − have, 0)
 *
 * This module owns the *shape* and the pure derivations (severity, sorting,
 * per-category rollup). T-31 is not built yet, so a provisional provider in the
 * data layer fills it in — see `data/resource-calc.provider.ts`.
 */

import type { TrendSeries } from './trend';

export type ResourceCategory = 'food' | 'supply' | 'volunteer';

export const RESOURCE_CATEGORIES: ResourceCategory[] = ['food', 'supply', 'volunteer'];

export const RESOURCE_CATEGORY_LABEL: Record<ResourceCategory, string> = {
	food: 'อาหาร',
	supply: 'ของใช้',
	volunteer: 'อาสา'
};

/** Where the ratio behind a row came from (CR-006: shelter override beats master). */
export type RatioSource = 'master' | 'override';

export type Severity = 'critical' | 'low' | 'ok';

/** One resource item's requirement vs availability for the snapshot day. */
export interface GapRow {
	item_id: string;
	label: string;
	category: ResourceCategory;
	unit: string;
	/** occupancy × effective ratio. */
	need: number;
	/** current stock balance / available volunteers. */
	have: number;
	/** max(need − have, 0). */
	gap: number;
	ratio_source: RatioSource;
	/** Drill-down provenance — the inputs the engine used (DoD: trace the number). */
	provenance: {
		occupancy: number;
		/** Effective ratio per person per day. */
		ratio: number;
		stock: number;
		/** When these inputs were last known good. */
		as_of: string;
	};
}

/** Per-category rollup for the summary cards. */
export interface CategorySummary {
	category: ResourceCategory;
	label: string;
	total_items: number;
	short_items: number;
	/** Worst-case have/need across the category's items, clamped to [0, 1]. */
	coverage: number;
	severity: Severity;
}

/** Everything the dashboard needs for one shelter at one point in time. */
export interface ResourceCalcSnapshot {
	shelter_code: string;
	/** ISO datetime the snapshot was computed. */
	as_of: string;
	occupancy: number;
	rows: GapRow[];
	/** Per-category shortage trend, default last 7 days. */
	trend: TrendSeries[];
}

export function computeGap(need: number, have: number): number {
	return Math.max(need - have, 0);
}

/** have/need clamped to [0, 1]; a zero/negative need counts as fully covered. */
export function coverage(need: number, have: number): number {
	if (need <= 0) return 1;
	return Math.max(0, Math.min(have / need, 1));
}

/** ok when nothing is short; critical under 50% coverage; otherwise low. */
export function severityOf(need: number, have: number): Severity {
	if (computeGap(need, have) <= 0) return 'ok';
	return coverage(need, have) < 0.5 ? 'critical' : 'low';
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, low: 1, ok: 2 };

/** Most-severe first; ties broken by lower coverage, then larger gap. */
export function sortBySeverity(rows: GapRow[]): GapRow[] {
	return [...rows].sort((a, b) => {
		const ra = SEVERITY_RANK[severityOf(a.need, a.have)];
		const rb = SEVERITY_RANK[severityOf(b.need, b.have)];
		if (ra !== rb) return ra - rb;

		const ca = coverage(a.need, a.have);
		const cb = coverage(b.need, b.have);
		if (ca !== cb) return ca - cb;

		return b.gap - a.gap;
	});
}

/** Roll rows up to one summary per category (always returns all 3, in order). */
export function summarizeByCategory(rows: GapRow[]): CategorySummary[] {
	return RESOURCE_CATEGORIES.map((category) => {
		const items = rows.filter((r) => r.category === category);
		const short = items.filter((r) => r.gap > 0);
		const worstCoverage = items.reduce((min, r) => Math.min(min, coverage(r.need, r.have)), 1);
		const severity: Severity = short.length === 0 ? 'ok' : worstCoverage < 0.5 ? 'critical' : 'low';

		return {
			category,
			label: RESOURCE_CATEGORY_LABEL[category],
			total_items: items.length,
			short_items: short.length,
			coverage: worstCoverage,
			severity
		};
	});
}
