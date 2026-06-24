// Domain (public)
export {
	operationStatusSchema,
	zoneTypeSchema,
	zoneStatusSchema,
	powerSourceSchema,
	waterSourceSchema,
	communicationChannelSchema,
	subStorageTypeSchema,
	locationSchema,
	contactSchema,
	facilitiesSchema,
	subStorageItemSchema,
	commonAreasSchema,
	utilitiesSchema,
	utilitiesBaseSchema,
	riskSchema,
	zoneSchema,
	shelterSchema,
	createShelterSchema,
	updateShelterSchema,
	migrateShelterV2ToCurrent,
	type OperationStatus,
	type ZoneType,
	type ZoneStatus,
	type PowerSource,
	type WaterSource,
	type CommunicationChannel,
	type SubStorageType,
	type Location,
	type Contact,
	type Facilities,
	type SubStorageItem,
	type CommonAreas,
	type Utilities,
	type Risk,
	type Zone,
	type Shelter,
	type CreateShelterInput,
	type UpdateShelterInput,
	type ShelterMasterV2,
	type ShelterMaster
} from './domain/schema';

// Data layer (public)
export {
	listShelters,
	getShelter,
	createShelter,
	updateShelter,
	closeZone,
	type ShelterSummary
} from './data/shelters.api';

// Application (public)
export {
	sheltersKeys,
	useShelters,
	useShelter,
	useCreateShelter,
	useUpdateShelter,
	useCloseZone
} from './application/queries';

// UI (public — single page now handles create+edit via isEdit prop)
export { default as ShelterFormPage } from './ui/shelter-form-page.svelte';
export { default as ShelterList } from './ui/shelter-list.svelte';
export { default as BasicInfoSection } from './ui/basic-info-section.svelte';
export { default as CapacitySection } from './ui/capacity-section.svelte';
export { default as ZonesFacilitiesSection } from './ui/zones-facilities-section.svelte';
export { default as UtilitiesSection } from './ui/utilities-section.svelte';
export { default as RiskSection } from './ui/risk-section.svelte';
