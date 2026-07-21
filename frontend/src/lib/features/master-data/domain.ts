/**
 * Server-safe facade — domain types/constants only (no Svelte UI).
 * BFF routes and `$lib/server/*` import from here so Vitest/Node never
 * resolves `.svelte` barrels. Client code continues to use the feature barrel.
 */
export {
	MASTER_DATA_TYPES,
	REGISTRATION_MASTER_TYPES,
	HOUSEHOLD_MASTER_TYPES,
	SHELTER_MASTER_TYPES,
	MASTER_DATA_TYPE_LABELS,
	masterTypeSchema,
	masterDataSchema,
	masterDataItemSchema,
	itemInputSchema,
	slugifyLabel,
	uniqueCode,
	enforceOneDefault,
	applyItemOp,
	createMasterData,
	touchMasterData,
	masterDocId,
	makeRegistryDoc,
	isMasterData,
	type MasterDataType,
	type MasterDataItem,
	type MasterDataRecordScope,
	type MasterDataItemSource,
	type MasterData,
	type ItemInput,
	type ItemOp,
	type RegistryAuthorContext
} from './domain/master-data';
