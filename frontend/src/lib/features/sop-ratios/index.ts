export type { SopRatioProfile } from './domain/sop-ratio';

export {
	createInitialProfile,
	createNewVersion,
	isSopRatioProfile,
	SOP_RATIO_KEYS,
	sopRatioProfileSchema,
	type CreateNewVersionResult,
	type SopRatioKey
} from './domain/sop-ratio';

// Trend series shapes (shared by chart + resource-calc snapshot)
export type { TrendPoint, TrendSeries } from './domain/trend';

// Resource-shortage trend chart (T-32.4)
export { default as TrendChart } from './ui/trend-chart.svelte';
export {
	MAX_TREND_ROWS,
	capSeries,
	downsamplePoints,
	wasAggregated
} from './ui/trend-chart.aggregate';

// Resource calculation dashboard (T-32 / FR-46)
export { default as ResourceDashboard } from './ui/resource-dashboard.svelte';
export { useResourceCalc, resourceCalcKeys } from './application/resource-calc';
export {
	computeGap,
	coverage,
	severityOf,
	sortBySeverity,
	summarizeByCategory,
	RESOURCE_CATEGORIES,
	RESOURCE_CATEGORY_LABEL,
	type ResourceCalcSnapshot,
	type GapRow,
	type CategorySummary,
	type ResourceCategory,
	type RatioSource,
	type Severity
} from './domain/resource-calc';
