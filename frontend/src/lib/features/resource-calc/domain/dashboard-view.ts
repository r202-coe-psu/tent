/**
 * T-32 — pure presentation-derivations for the resource-needs dashboard.
 *
 * Operates ONLY on `ResourceCalcResult` (the engine output, T-31.1) — no I/O, no Svelte,
 * no sop-ratios import. Turns a computed row into the two operational lenses the dashboard
 * shows: "days of supply" (how long current stock lasts) and a display `Severity`.
 *
 * DAYS-OF-SUPPLY applies to CONSUMABLES only (`kind === 'multiply'`, where `need` is the
 * per-day requirement `occupancy × ratio`). Facilities (`divide`) and quality ceilings
 * (`threshold`) have no meaningful days-of-supply → `null`.
 */
import { parseQty, qtyGt } from '$lib/utils/qty';
import type { ResourceCalcResult } from './calc.formula';

/**
 * Display severity for one row (ordered most→least urgent by {@link SEVERITY_RANK}):
 * - `crit`       — consumable running out fast / facility deficit is large
 * - `watch`      — getting low
 * - `ok`         — sufficient (incl. surplus)
 * - `constraint` — a `threshold` quality ceiling (informational, never a stock quantity)
 * - `nodata`     — computation incomplete (`ratio_missing` / `stock_unsynced` / `invalid_input`)
 */
export type Severity = 'crit' | 'watch' | 'ok' | 'constraint' | 'nodata';

/** Ascending urgency rank — lower sorts first ("most severe first"). */
export const SEVERITY_RANK: Record<Severity, number> = {
	crit: 0,
	watch: 1,
	constraint: 2,
	nodata: 3,
	ok: 4
};

/** Below this many days of stock left → critical. */
export const DAYS_CRITICAL = 3;
/** Below this many days of stock left → watch. */
export const DAYS_WATCH = 7;
/** Facility (`divide`) shortfall ratio (gap / need) at/above which → critical. */
export const FACILITY_CRIT_SHORTFALL = 0.4;

/**
 * Days the current stock (`have`) lasts at the per-day requirement (`need`).
 * Consumables only; `null` when not applicable (non-multiply, no stock, or zero need).
 */
export function daysOfSupply(r: ResourceCalcResult): number | null {
	if (r.kind !== 'multiply') return null;
	// `have` / `need` are decimal strings (CR-038); guard a positive per-day need before dividing.
	if (r.have == null || r.need == null || !qtyGt(r.need, 0)) return null;
	return parseQty(r.have).dividedBy(parseQty(r.need)).toNumber();
}

/** Map one computed row to its display {@link Severity}. */
export function rowSeverity(r: ResourceCalcResult): Severity {
	// Data-availability first: an incomplete computation is never a green/red verdict.
	if (r.data_status !== 'complete' || r.status === 'insufficient_data') return 'nodata';
	// Quality ceiling — informational, not a quantity.
	if (r.kind === 'threshold' || r.status === 'constraint') return 'constraint';

	if (r.kind === 'multiply') {
		const dos = daysOfSupply(r);
		if (dos == null) return 'nodata';
		if (dos < DAYS_CRITICAL) return 'crit';
		if (dos < DAYS_WATCH) return 'watch';
		return 'ok';
	}

	// divide (facilities): severity from the shortfall ratio (gap / need).
	if (r.status === 'surplus' || r.status === 'ok') return 'ok';
	if (r.need == null || r.gap == null || !qtyGt(r.need, 0)) return 'ok';
	const shortfall = parseQty(r.gap).dividedBy(parseQty(r.need)).toNumber();
	if (shortfall >= FACILITY_CRIT_SHORTFALL) return 'crit';
	if (shortfall > 0) return 'watch';
	return 'ok';
}

/** Count of rows per severity (for the KPI tiles). Includes a `total`. */
export interface SeveritySummary {
	crit: number;
	watch: number;
	ok: number;
	constraint: number;
	nodata: number;
	total: number;
}

export function summarizeStatuses(results: readonly ResourceCalcResult[]): SeveritySummary {
	const s: SeveritySummary = { crit: 0, watch: 0, ok: 0, constraint: 0, nodata: 0, total: 0 };
	for (const r of results) {
		s[rowSeverity(r)]++;
		s.total++;
	}
	return s;
}

/** Rows sorted most-severe first; ties keep the engine's `ordinal` order (stable). */
export function sortBySeverity(results: readonly ResourceCalcResult[]): ResourceCalcResult[] {
	return [...results].sort((a, b) => {
		const d = SEVERITY_RANK[rowSeverity(a)] - SEVERITY_RANK[rowSeverity(b)];
		return d !== 0 ? d : a.ordinal - b.ordinal;
	});
}
