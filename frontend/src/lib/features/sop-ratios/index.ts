export type { SopMaster, SopOverride } from './domain/sop-ratio';

export {
	createInitialProfile,
	createNewVersion,
	isSopMaster,
	isSopOverride,
	resolveEffectiveProfile,
	SOP_RATIO_KEYS,
	SOP_RATIO_KIND,
	sopMasterSchema,
	sopOverrideSchema,
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

// Data — repositories + resolver
export type { SopMasterRepository, SopOverrideRepository } from './data/sop-ratio.repository';
export {
	sopMasterRepository,
	sopOverrideRepository,
	resolveEffectiveRatios
} from './data/sop-ratio.remote';

// Application — TanStack Query hooks (T-30.5)
export {
	sopRatioKeys,
	useActiveSopProfile,
	useActiveSopRatio,
	useSopProfiles,
	getActiveSopProfile,
	sopVersionKeys
} from './application/queries';

// Version history
export {
	useOverrideVersionHistory,
	useMasterVersionHistory
} from './application/use-version-history';

// Version creation mutations
export {
	useCreateMasterVersion,
	useCreateOverrideVersion,
	type CreateMasterVersionInput,
	type CreateOverrideVersionInput
} from './application/use-create-version';

// Live-sync wiring (call once per layout, pass QueryClient)
export { startSopRatioLiveQuery } from './application/sop-ratio-sync';
