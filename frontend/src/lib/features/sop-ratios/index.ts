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
	useMasterVersionHistory
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

// UI — Svelte components (T-30.6)
export { default as SopMasterTable } from './ui/sop-master-table.svelte';
export { default as SopEditForm } from './ui/sop-edit-form.svelte';
export { default as VersionHistoryDrawer } from './ui/version-history-drawer.svelte';
