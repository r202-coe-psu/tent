// Public barrel for the sop-ratios feature. Domain-only (types, repository contracts, and TanStack query hooks).
export type {
	SopMaster,
	SopOverride,
	SopProfile,
	SopProfileDoc,
	SopProfileInput,
	SopProfileVersion,
	SopProfileVersionDoc
} from './domain/sop-ratio';

export {
	createInitialProfile,
	createNewVersion,
	createProfileSlug,
	incrementVersion,
	isSopMaster,
	isSopOverride,
	resolveEffectiveProfile,
	verifyMasterPointerMatch,
	SOP_RATIO_KEYS,
	SOP_RATIO_KIND,
	sopMasterSchema,
	sopProfileFormSchema,
	sopProfileInputSchema,
	sopProfileSlugSchema,
	sopOverrideSchema,
	SOP_MASTER_SCHEMA_VERSION,
	type CreateNewVersionResult,
	type SopRatioKey,
	validateRatios
} from './domain/sop-ratio';
export { RATIO_LABELS } from './domain/sop-ratio.labels';
export { SopMasterIntegrityError, type SopMasterIntegrityIssue } from '$lib/utils/errors';

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
	getVerifiedActiveMaster,
	SopMasterRemoteRepository,
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
	useAllMasterProfiles,
	useMasterProfile,
	useActiveSopOverride,
	getActiveSopProfile,
	getVerifiedActiveSopProfile,
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
	useCreateInitialMaster,
	useSetMasterActive,
	useDeactivateMaster,
	useSetOverrideActive,
	useSetOverrideInactive,
	type CreateMasterVersionInput,
	type CreateOverrideVersionInput,
	type CreateInitialOverrideInput,
	type CreateInitialMasterInput
} from './application/use-create-version';

// Live-sync wiring (call once per layout, pass QueryClient)
export { startSopRatioLiveQuery } from './application/sop-ratio-sync';
