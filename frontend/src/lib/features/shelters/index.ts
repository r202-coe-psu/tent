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
	areaTypeSchema,
	projectLevelSchema,
	keyPersonContactSchema,
	keyPersonnelSchema,
	petCategorySchema,
	smallGeneralConditionSchema,
	largeDogConditionSchema,
	livestockConditionSchema,
	petCategoryEntrySchema,
	petPolicySchema,
	admissionPolicySchema,
	luggageRuleSchema,
	luggagePolicySchema,
	vehicleTypeSchema,
	parkingRuleSchema,
	supportedVehicleSchema,
	parkingPolicySchema,
	shelterSchema,
	createShelterSchema,
	updateShelterSchema,
	migrateShelterV2ToCurrent,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
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
	type AreaType,
	type ProjectLevel,
	type KeyPersonContact,
	type KeyPersonnel,
	type PetCategory,
	type SmallGeneralCondition,
	type LargeDogCondition,
	type LivestockCondition,
	type PetCondition,
	type PetCategoryEntry,
	type PetPolicy,
	type AdmissionPolicy,
	type LuggageRule,
	type LuggagePolicy,
	type VehicleType,
	type ParkingRule,
	type SupportedVehicle,
	type ParkingPolicy,
	type Shelter,
	type CreateShelterInput,
	type UpdateShelterInput,
	type ShelterMasterV2,
	type ShelterMaster
} from './domain/schema';

// Data layer (public)
export { createShelter, updateShelter, closeZone, reopenZone } from './data/shelters.api';
export { sheltersRepository, SHELTER_REGISTRY_DB } from './data/shelters.pouch';
export type { ShelterSummary } from './data/shelters.repository';

// Application (public)
export {
	sheltersKeys,
	startSheltersLiveQuery,
	useShelters,
	useShelter,
	useCreateShelter,
	useUpdateShelter,
	useCloseZone,
	useReopenZone
} from './application/queries';

// UI (public — single page now handles create+edit via isEdit prop)
export { default as ShelterFormPage } from './ui/shelter-form-page.svelte';
export { default as ShelterList } from './ui/shelter-list.svelte';
export { default as BasicInfoSection } from './ui/basic-info-section.svelte';
export { default as CapacitySection } from './ui/capacity-section.svelte';
export { default as ZonesFacilitiesSection } from './ui/zones-facilities-section.svelte';
export { default as UtilitiesSection } from './ui/utilities-section.svelte';
export { default as RiskSection } from './ui/risk-section.svelte';
export { default as AdmissionPolicySection } from './ui/admission-policy-section.svelte';
export { default as LuggagePolicySection } from './ui/luggage-policy-section.svelte';
export { default as ParkingPolicySection } from './ui/parking-policy-section.svelte';
