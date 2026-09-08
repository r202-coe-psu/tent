/**
 * Server-safe entry point for the public-register feature.
 *
 * The barrel (`$lib/features/public-register`) re-exports Svelte components and
 * TanStack hooks; importing it from a `+server.ts` drags those into the SSR
 * module graph (see `$lib/features/public-portal/server.ts` for the failure that
 * caused). Everything below is pure — no I/O, no Svelte.
 */
export {
	bookingCodeFrom,
	bookingGenderSchema,
	bookingNationalIdSchema,
	bookingPhoneSchema,
	bookingShelterCodeSchema,
	evacueeIdFromBookingCode,
	householdLabelFrom,
	isCaptchaKeyConfigured,
	publicBookingAddressSchema,
	publicBookingErrorMessage,
	publicBookingInputSchema,
	publicBookingLookupSchema,
	publicBookingMemberSchema,
	publicBookingPetSchema,
	publicBookingVehicleSchema,
	publicBookingVehicleTypeSchema,
	toEvacueeInputs,
	toHouseholdInput
} from './domain/booking';

export {
	findDuplicateHold,
	holdConflictsWithBooking,
	isActiveHoldStatus,
	isForecastCapacityExceeded,
	ACTIVE_HOLD_STATUSES
} from './domain/booking-gate';

export type {
	PublicBookingAddress,
	PublicBookingErrorCode,
	PublicBookingInput,
	PublicBookingLookupInput,
	PublicBookingMember
} from './domain/booking';

export {
	toUnassignedRegistrationPayload,
	unassignedRegistrationErrorMessage,
	unassignedRegistrationInputSchema,
	unassignedHouseholdInputSchema,
	unassignedMemberInputSchema
} from './domain/unassigned-registration';

export type {
	UnassignedRegistrationErrorCode,
	UnassignedRegistrationInput,
	UnassignedRegistrationPayload
} from './domain/unassigned-registration';

export {
	executePublicFamilyRegistration,
	PublicRegistrationWriteError
} from './public-family-registration.server';

export type {
	ExecutePublicFamilyRegistrationOptions,
	PublicFamilyRegistrationResult
} from './public-family-registration.server';
