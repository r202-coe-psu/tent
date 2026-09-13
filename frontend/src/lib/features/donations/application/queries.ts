import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	cancelDonation,
	fetchDonationTracking,
	searchDonationTracking,
	updateCourierTracking,
	updateDonationItems,
	type DonationItemEdit
} from '../data/public-tracking';
import { fetchShelterNeeds } from '../data/public-needs';

export const donationTrackingKeys = {
	all: ['donations', 'tracking'] as const,
	detail: (token: string) => [...donationTrackingKeys.all, token] as const
};

export function useDonationTracking(token: () => string) {
	return createQuery(() => ({
		queryKey: donationTrackingKeys.detail(token()),
		queryFn: () => fetchDonationTracking(token()),
		enabled: Boolean(token().trim()),
		retry: false
	}));
}

export function useDonationTrackSearch() {
	return createMutation(() => ({
		mutationFn: (input: { bookingRef: string; phone: string }) => searchDonationTracking(input)
	}));
}

export function useUpdateCourierTracking() {
	return createMutation(() => ({
		mutationFn: (input: { token: string; courierTrackingNo: string }) =>
			updateCourierTracking(input.token, input.courierTrackingNo)
	}));
}

export function useCancelDonation() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { token: string }) => cancelDonation(input.token),
		onSuccess: (_data, input) =>
			queryClient.invalidateQueries({ queryKey: donationTrackingKeys.detail(input.token) })
	}));
}

/**
 * Open needs of the shelter a booking belongs to — what the donor may add to it.
 *
 * Separate key space from the tracking detail: the board moves as other donors book,
 * and an edit dialog opening later should see the current list rather than a snapshot
 * taken with the booking.
 */
export function usePublicShelterNeeds(shelterCode: () => string) {
	return createQuery(() => ({
		queryKey: ['public-needs', shelterCode()],
		queryFn: () => fetchShelterNeeds(shelterCode()),
		enabled: !!shelterCode()
	}));
}

export function useUpdateDonationItems() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { token: string; items: DonationItemEdit[] }) =>
			updateDonationItems(input.token, input.items),
		// Refetch rather than patch the cache: the service decides the stored shape
		// (reserved_qty per item, the revision entry), and guessing it here is how the
		// two drift apart.
		onSuccess: (_data, input) =>
			queryClient.invalidateQueries({ queryKey: donationTrackingKeys.detail(input.token) })
	}));
}
