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
	SpecialNeed,
	StayStatus,
	MovementAction,
	CareTrack,
	BloodGroup
} from './domain/people';

// Domain — input schemas + factories + transitions + guards
export {
	genderSchema,
	religionSchema,
	specialNeedSchema,
	stayStatusSchema,
	movementActionSchema,
	careTrackSchema,
	bloodGroupSchema,
	evacueeInputSchema,
	medicalInputSchema,
	householdInputSchema,
	movementInputSchema,
	screeningInputSchema,
	createEvacuee,
	createMedical,
	createHousehold,
	createMovement,
	createScreening,
	applyMovementToStay,
	maskNationalId,
	zoneLabel,
	SPECIAL_NEED_CHIPS,
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

export type { PeopleRepository } from './data/people.repository';
export { peopleRepository } from './data/people.remote';
export { getShelterCode, getShelterDb } from '$lib/db/shelter';

// Application — TanStack Query hooks + changes-feed live-query wiring
export {
	peopleKeys,
	useEvacuees,
	useEvacueesPaginated,
	useSearchEvacuees,
	useCreateEvacuee,
	useUpdateEvacuee,
	useCheckInEvacuee,
	useHouseholds,
	useHouseholdsPaginated,
	useCreateHousehold,
	useUpdateHousehold,
	useCreateScreening,
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
export { default as EvacueeWristbandSuccess } from './ui/evacuee-wristband-success.svelte';
