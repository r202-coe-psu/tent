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
export { default as BookingTicketView } from './ui/booking-ticket.svelte';
export { default as TicketHistory } from './ui/ticket-history.svelte';

// application
export {
	getBookingStore,
	setBookingStore,
	type BookingStep,
	type BookingStore,
	type BookingTicket as BookingTicketModel
} from './application/booking-store.svelte';
export {
	publicRegisterKeys,
	useBookingDistricts,
	useBookingLookup,
	useBookingProvinces,
	useBookingSubdistricts,
	useCreateBooking,
	usePetTypes
} from './application/queries';

// data
export {
	createBooking,
	fetchDistricts,
	fetchPetTypes,
	fetchProvinces,
	fetchSubdistricts,
	lookupBooking,
	type BookingTicketResponse,
	type PetTypeOption,
	type PublicSubdistrict
} from './data/public-register.api';
export {
	getStoredTickets,
	getLatestStoredTicket,
	saveTicketToStorage,
	removeStoredTicket,
	clearStoredTickets
} from './data/ticket-storage';

// domain
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
	publicBookingPetSpeciesSchema,
	publicBookingVehicleSchema,
	publicBookingVehicleTypeSchema,
	toEvacueeInputs,
	toHouseholdInput
} from './domain/booking';

export type {
	PublicBookingAddress,
	PublicBookingErrorCode,
	PublicBookingInput,
	PublicBookingLookupInput,
	PublicBookingMember
} from './domain/booking';
