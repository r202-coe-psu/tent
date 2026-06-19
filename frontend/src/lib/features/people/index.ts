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

// Data — repository contract + PouchDB binding
export type { PeopleRepository } from './data/people.repository';
export { peopleRepository, SHELTER_CODE, SHELTER_DB } from './data/people.pouch';

// Application — TanStack Query hooks + changes-feed live-query wiring
export {
	peopleKeys,
	useEvacuees,
	useEvacueesPaginated,
	useCreateEvacuee,
	useUpdateEvacuee,
	startPeopleLiveQuery
} from './application/queries';

// UI — feature components
export { default as EvacueeForm } from './ui/evacuee-form.svelte';
export { default as EvacueeList } from './ui/evacuee-list.svelte';
