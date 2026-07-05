// Public barrel for the resource-calc feature (T-31). Domain-only (T-31.1 formula + T-31.2 schemas + T-31.3 edge status).
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
