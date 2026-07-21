/**
 * Public API of the `master-data` feature (CR-010). Cross-feature and route
 * code imports ONLY from here. Inner layers (domain/data/application/ui) are
 * private — reaching into them from outside is an ESLint error.
 */

// Domain — types, enums, labels, factories
export {
	MASTER_DATA_TYPES,
	REGISTRATION_MASTER_TYPES,
	HOUSEHOLD_MASTER_TYPES,
	SHELTER_MASTER_TYPES,
	MASTER_DATA_TYPE_LABELS,
	masterDataScopeSchema,
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
	type MasterDataScope,
	type MasterDataQueryContext,
	type MasterDataItem,
	type MasterData,
	type ItemInput,
	type ItemOp,
	type RegistryAuthorContext
} from './domain/master-data';

// Data — service plane client (CR-010)
export {
	listMasters,
	getMaster,
	putMaster,
	deleteItem,
	type MasterDataSummary
} from './data/master-data.api';

// Application — TanStack Query hooks
export {
	masterDataKeys,
	useMasterDataList,
	useMasterData,
	usePutMaster,
	useDeleteMasterItem
} from './application/queries';

// UI — feature components
export { default as MasterDataConfigPage } from './ui/master-data-config-page.svelte';
export { default as MasterDataTypeList } from './ui/master-data-type-list.svelte';
export { default as MasterDataItemList } from './ui/master-data-item-list.svelte';
export { default as MasterDataEditModal } from './ui/master-data-edit-modal.svelte';
