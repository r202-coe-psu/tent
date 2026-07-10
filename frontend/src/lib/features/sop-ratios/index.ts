// Public barrel for the sop-ratios feature. Domain-only (types, repository contracts, and TanStack query hooks).
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
	SOP_MASTER_SCHEMA_VERSION,
	type CreateNewVersionResult,
	type SopRatioKey
} from './domain/sop-ratio';
export { RATIO_LABELS } from './domain/sop-ratio.labels';

// Trend series shapes (shared by chart + resource-calc snapshot)
export type { TrendPoint, TrendSeries } from './domain/trend';

// Resource-shortage trend chart (T-32.4)
export {
	MAX_TREND_ROWS,
	capSeries,
	downsamplePoints,
	wasAggregated
} from './ui/trend-chart.aggregate';
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
	useActiveSopOverride,
	getActiveSopProfile,
	sopVersionKeys
} from './application/queries';

// Version history
export {
	useOverrideVersionHistory,
	useMasterVersionHistory,
	type SopMasterWithReason,
	type SopOverrideWithReason
} from './application/use-version-history';

// Version creation mutations
export {
	useCreateMasterVersion,
	useCreateOverrideVersion,
	useCreateInitialOverride,
	useSetMasterActive,
	useSetOverrideActive,
	useSetOverrideInactive,
	type CreateMasterVersionInput,
	type CreateOverrideVersionInput,
	type CreateInitialOverrideInput
} from './application/use-create-version';

// Live-sync wiring (call once per layout, pass QueryClient)
export { startSopRatioLiveQuery } from './application/sop-ratio-sync';
