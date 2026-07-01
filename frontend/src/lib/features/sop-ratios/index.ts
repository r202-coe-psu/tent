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

// Application — TanStack Query hooks
export {
	sopRatioKeys,
	useActiveSopProfile,
	useSopProfiles,
	getActiveSopProfile
} from './application/queries';
