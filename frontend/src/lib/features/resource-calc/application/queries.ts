/**
 * T-31.5 — TanStack Query key factory for the daily resource-calc feature.
 *
 * Keys live here (mirrors `sop-ratios/application/queries.ts`); the individual
 * hooks live in `use-daily-calc.ts` / `use-run-calc.ts` / `use-calc-range.ts`
 * and the live-sync wiring in `calc-sync.ts`.
 */
export const calcKeys = {
	all: ['daily_calc'] as const,
	byDate: (date: string) => [...calcKeys.all, 'date', date] as const,
	range: (from: string, to: string) => [...calcKeys.all, 'range', from, to] as const
};
