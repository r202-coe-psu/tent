import { createMutation } from '@tanstack/svelte-query';
import { createBooking, lookupBooking } from '../data/public-register.api';
import type { PublicBookingInput, PublicBookingLookupInput } from '../domain/booking';

export const publicRegisterKeys = {
	all: ['public-register'] as const,
	booking: (code: string) => [...publicRegisterKeys.all, 'booking', code] as const
};

/** POST a new booking. Not a query — a booking must never be replayed from cache. */
export function useCreateBooking() {
	return createMutation(() => ({
		mutationFn: (input: PublicBookingInput) => createBooking(input)
	}));
}

/** Code + phone self-lookup (D-BOOK-TOKEN=A). A mutation so the phone never lands in a query key. */
export function useBookingLookup() {
	return createMutation(() => ({
		mutationFn: (input: PublicBookingLookupInput) => lookupBooking(input)
	}));
}
