/**
 * Public API of the `people` feature (FR-4..13 registration baseline).
 * Cross-feature and route code imports ONLY from here.
 */

// Domain — documents
export type {
	Evacuee,
	Medical,
	Household,
	Movement,
	Screening,
	PeopleDoc,
	CurrentStay,
	EmergencyContact,
	PetGroup,
	HouseholdVehicle,
	HouseholdAsset,
	MovementDestination,
	Gender,
	Religion,
	StayStatus,
	HouseholdStatus,
	MovementAction,
	CareTrack,
	TriageLevel,
	BloodGroup,
	CardType,
	CardSnapshot
} from './domain/people';

// Domain — input schemas + factories + transitions + guards
export {
	genderSchema,
	religionSchema,
	stayStatusSchema,
	STATUS_LABELS,
	householdStatusSchema,
	movementActionSchema,
	careTrackSchema,
	triageLevelSchema,
	bloodGroupSchema,
	cardSnapshotSchema,
	evacueeInputSchema,
	medicalInputSchema,
	householdInputSchema,
	evacueePersonalEditFormSchema,
	evacueeEmergencyEditFormSchema,
	evacueeAddressEditFormSchema,
	evacueeHealthEditFormSchema,
	evacueeHouseholdEditFormSchema,
	evacueeAssetsEditFormSchema,
	movementInputSchema,
	screeningInputSchema,
	createEvacuee,
	createDraftEvacueeFromCard,
	createKioskEvacueeFromCard,
	createMedical,
	createHousehold,
	createMovement,
	createScreening,
	assertMovementAllowed,
	canCheckInEvacuee,
	canCheckOutEvacuee,
	canChangeEvacueeZone,
	canCancelEvacueePreRegistration,
	canCancelHouseholdPreRegistration,
	CHECK_IN_ELIGIBLE_STATUSES,
	CHECK_OUT_ELIGIBLE_STATUSES,
	ZONE_CHANGE_ELIGIBLE_STATUSES,
	ACTIVE_HOUSEHOLD_STATUSES,
	HOUSEHOLD_STATUS_TRANSITIONS,
	MANUAL_HOUSEHOLD_STATUS_TRANSITIONS,
	isActiveHouseholdStatus,
	checkEvacueeHouseholdConflict,
	assertEvacueeHouseholdAssignment,
	assertHouseholdStatusTransition,
	assertCheckoutDestination,
	applyMovementToStay,
	maskNationalId,
	formatPersonName,
	matchesEvacueeSearch,
	zoneLabel,
	evacueeAgeYears,
	EWAR_SYMPTOM_GROUPS,
	isEvacuee,
	isMedical,
	isHousehold,
	isMovement,
	isScreening,
	type EvacueeInput,
	type MedicalInput,
	type HouseholdInput,
	type MovementInput,
	type ScreeningInput
} from './domain/people';

export {
	nextQueueLabel,
	classifyZoningQueueTab,
	recommendZoneKind,
	countOccupantsByZone,
	parseZoningQrCode,
	buildZoningPath,
	type NextQueueLabel,
	type ZoningQueueTab,
	type ZoningRecommendKind
} from './domain/intake-pipeline';

export type { PeopleRepository, EvacueeFilters, HouseholdFilters } from './data/people.repository';
export { peopleRepository } from './data/people.remote';
export { getShelterCode, getShelterDb } from '$lib/db/shelter';

// Application — TanStack Query hooks + changes-feed live-query wiring
export {
	peopleKeys,
	useEvacuees,
	useEvacuee,
	usePendingScreeningEvacuees,
	useEvacueesPaginated,
	useSearchEvacuees,
	useCreateEvacuee,
	useUpdateEvacuee,
	useCheckInEvacuee,
	useCheckOutEvacuee,
	useChangeEvacueeZone,
	lookupEvacueeByScanCode,
	useHouseholds,
	useHousehold,
	useHouseholdsPaginated,
	listMatchingEvacueeIds,
	listMatchingHouseholdIds,
	useCreateHousehold,
	useUpdateHousehold,
	usePatchHousehold,
	useCancelPreRegistration,
	useCancelEvacueePreRegistration,
	useCreateMedical,
	useCreateScreening,
	useRecordMedicalScreening,
	useCreateEvacueeWithScreening,
	useUpdateMedical,
	usePatchMedical,
	useDeleteMedical,
	usePatchEvacuee,
	useMedicals,
	useMovements,
	useScreenings,
	startPeopleLiveQuery
} from './application/queries';

// UI — feature components
export { default as EvacueeProfileView } from './ui/evacuee-profile-view.svelte';
export { default as EvacueeForm } from './ui/evacuee-form.svelte';
export { default as EvacueeList } from './ui/evacuee-list.svelte';
export { default as HouseholdForm } from './ui/household-form.svelte';
export { default as HouseholdFormPage } from './ui/household-form-page.svelte';
export { default as HouseholdPostArrival } from './ui/household-post-arrival.svelte';
export { default as EvacueeWristbandSuccess } from './ui/evacuee-wristband-success.svelte';
export {
	default as EvacueeHandoverSlipModal,
	buildScreeningDeepLink
} from './ui/evacuee-handover-slip-modal.svelte';
export { default as ScanCheckInOutPage } from './ui/scan-check-in-out-page.svelte';
export { default as EvacueePetAssetVehicle } from './ui/evacuee-pet-asset-vehicle.svelte';
export { default as HouseholdPreRegister } from './ui/household-pre-register.svelte';
export { default as HouseholdPreRegisterSummary } from './ui/household-pre-register-summary.svelte';
export { default as HouseholdProfileView } from './ui/household-profile-view.svelte';
export { default as RegistrationSaveErrorAlert } from './ui/registration-save-error-alert.svelte';
export {
	buildSaveFailureReport,
	formatSaveFailureReport,
	type SaveFailureReport
} from '$lib/utils/errors';

// UI — i18n dictionaries used directly by route pages
export { EVACUEE_PAGE_I18N, type EvacueePageI18n } from './ui/_constants/evacuee-page.i18n';

// UI — shared sub-form components (Issue #205)
export {
	PersonalInfoFields,
	SpecialNeedsFields,
	SPECIAL_NEEDS_COMMON_TAGS,
	EmergencyContactFields,
	EwarSymptomsFields,
	HouseholdAddressFields,
	PetAssetVehicleFields,
	HealthMedicalFields,
	ZoneSelectionFields,
	type SpecialNeedTag,
	type ZoneItem
} from './ui/forms/index.js';
