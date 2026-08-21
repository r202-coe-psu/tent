import { createMutation, createQuery } from '@tanstack/svelte-query';
import { createBooking, fetchPetTypes, lookupBooking } from '../data/public-register.api';
import type { PublicBookingInput, PublicBookingLookupInput } from '../domain/booking';

export const publicRegisterKeys = {
	all: ['public-register'] as const,
	booking: (code: string) => [...publicRegisterKeys.all, 'booking', code] as const,
	petTypes: (shelterCode: string) => [...publicRegisterKeys.all, 'pet-types', shelterCode] as const
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

/**
 * Pet species offered by the shelter currently selected in the booking form.
 * `shelterCode` is a getter, not a plain string — the shelter is picked
 * *inside* the form (unlike `vulnerableGroups`, loaded once by the modal
 * before the form even mounts), so this must re-run reactively as the citizen
 * changes their selection. TanStack Query keys the cache by the resolved
 * shelter code, so re-selecting a shelter already picked earlier in the same
 * session is served from cache instead of refetched.
 */
export function usePetTypes(shelterCode: () => string) {
	return createQuery(() => ({
		queryKey: publicRegisterKeys.petTypes(shelterCode()),
		queryFn: () => fetchPetTypes(shelterCode()),
		enabled: Boolean(shelterCode().trim()),
		staleTime: 5 * 60 * 1000
	}));
}
