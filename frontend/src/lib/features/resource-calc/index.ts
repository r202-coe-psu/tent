// Public barrel for the resource-calc feature (T-31) — the ONLY entry point other code may import.
//
// Public contract for T-25/T-32/T-23 and other consumers. Breaking changes to any exported
// shape here require a CR (see docs/change-management.md) + a FORMULA_V bump.
// Enforced by team review process (same as every other CR in this project) — NOT by tooling/CI;
// there is no automated check for this.
export {
	calculateResources,
	FORMULA_V,
	type CalcInput,
	type ResourceInput,
	type ResourceCalcResult,
	type ResourceKey,
	type ResourceKind,
	type ResourceStatus,
	type DataStatus
} from './domain/calc.formula';

// T-31.2 — Zod schemas + snapshot types (additive; existing exports above unchanged).
export {
	resourceKindSchema,
	resourceStatusSchema,
	dataStatusSchema,
	resourceInputSchema,
	calcInputSchema,
	resourceCalcResultSchema,
	calcOutputSchema,
	dailyCalcDocSchema,
	DAILY_CALC_SCHEMA_VERSION,
	type ResourceInputParsed,
	type CalcInputParsed,
	type ResourceCalcResultParsed,
	type CalcOutput,
	type DailyCalcDoc
} from './domain/calc.schema';

// T-31.4 — data layer: the persisted daily-calc repository (occupancy × ratio → snapshot).
export {
	dailyCalcDocId,
	isDailyCalcRecord,
	DAILY_CALC_ID_PREFIX,
	type DailyCalcRepository,
	type DailyCalcRecord
} from './data/daily-calc.repository';
export { dailyCalcRepository, DailyCalcRemoteRepository } from './data/daily-calc.remote';

// T-31.5 — application layer: TanStack Query hooks + live-sync wiring.
export { calcKeys } from './application/queries';
export { useDailyCalc } from './application/use-daily-calc';
export { useRunCalc } from './application/use-run-calc';
export { useCalcRange } from './application/use-calc-range';
export { startDailyCalcLiveQuery } from './application/calc-sync';

// T-31.7 — ui layer: minimal status badge + on-demand trigger (NOT a dashboard — see T-32).
export { default as CalcStatusBadge } from './ui/calc-status-badge.svelte';
