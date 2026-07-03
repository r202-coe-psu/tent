export type { SopMaster, SopOverride } from './domain/sop-ratio';

export {
	createInitialProfile,
	createNewVersion,
	isSopMaster,
	isSopOverride,
	resolveEffectiveProfile,
	SOP_RATIO_KEYS,
	sopMasterSchema,
	sopOverrideSchema,
	type CreateNewVersionResult,
	type SopRatioKey
} from './domain/sop-ratio';

// Data — repositories + resolver
export type { SopMasterRepository, SopOverrideRepository } from './data/sop-ratio.repository';
export {
	sopMasterRepository,
	sopOverrideRepository,
	resolveEffectiveRatios
} from './data/sop-ratio.pouch';

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
