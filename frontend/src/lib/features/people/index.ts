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
