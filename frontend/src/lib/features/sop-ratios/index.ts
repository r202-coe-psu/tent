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

export { validRatios } from './domain/sop-ratio.fixture';

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

export { default as SopMasterTable } from './ui/sop-master-table.svelte';
export { default as SopEditForm } from './ui/sop-edit-form.svelte';
export { default as VersionHistoryDrawer } from './ui/version-history-drawer.svelte';
export { default as SopTypeList } from './ui/sop-type-list.svelte';
export type { SopTabType } from './ui/sop-type-list.svelte';
export { default as SopRatioTab } from './ui/sop-ratio-tab.svelte';
export { default as AlertThresholdStub } from './ui/alert-threshold-stub.svelte';
