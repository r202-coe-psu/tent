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
	evacueeIdFromBookingCode,
	householdLabelFrom,
	isCaptchaKeyConfigured,
	publicBookingErrorMessage,
	publicBookingInputSchema,
	publicBookingLookupSchema,
	publicBookingMemberSchema,
	publicBookingPetSchema,
	toEvacueeInputs,
	toHouseholdInput
} from './domain/booking';

export type {
	PublicBookingErrorCode,
	PublicBookingInput,
	PublicBookingLookupInput,
	PublicBookingMember
} from './domain/booking';
