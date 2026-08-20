/**
 * Public booking (จองเข้าศูนย์ผ่านเว็บ) — CR-070 / T-71.
 *
 * The only entry point other code may import. Server code that needs the pure
 * domain must use `$lib/features/public-register/server` instead, so Svelte
 * components stay out of the SSR module graph.
 */

// ui
export { default as BookingForm } from './ui/booking-form.svelte';
export { default as BookingModal } from './ui/booking-modal.svelte';
export { default as BookingTicket } from './ui/booking-ticket.svelte';

// application
export {
	getBookingStore,
	setBookingStore,
	type BookingStep,
	type BookingStore,
	type BookingTicket as BookingTicketModel
} from './application/booking-store.svelte';
export { publicRegisterKeys, useBookingLookup, useCreateBooking } from './application/queries';

// data
export {
	createBooking,
	lookupBooking,
	type BookingTicketResponse
} from './data/public-register.api';

// domain
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
	splitThaiName,
	toEvacueeInputs,
	toHouseholdInput
} from './domain/booking';

export type {
	PublicBookingErrorCode,
	PublicBookingInput,
	PublicBookingLookupInput,
	PublicBookingMember
} from './domain/booking';
