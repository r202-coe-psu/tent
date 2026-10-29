import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { fetchDonationQueue } from '../data/back-office-queue';
import {
	cancelDonation,
	fetchDonationTracking,
	lookupDonationsByPhone,
	searchDonationTracking,
	updateCourierTracking,
	updateDonationItems,
	type DonationItemEdit
} from '../data/public-tracking';
import { fetchShelterNeeds } from '../data/public-needs';
import { fetchDonationSlots } from '../data/public-slots';
import type { DonationSlotMode } from '$lib/features/operations';
import { resolveContextShelterCode } from '$lib/db/shelter';

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

/** Phone number alone → the bookings of it (CR-173). A mutation: it is a POST, never cached. */
export function useDonationPhoneLookup() {
	return createMutation(() => ({
		mutationFn: (input: { phone: string; captchaToken?: string }) => lookupDonationsByPhone(input)
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

/**
 * Queue windows for one shelter + date + queue (schema.md §2.13).
 *
 * The queue is part of the key because drop-off and pickup are different boards:
 * switching delivery method has to re-ask, not reuse the other queue's answer.
 *
 * Keyed on both, because capacity is per window per day: switching the date or the
 * shelter must show that day's board, not the one the wizard opened with. Kept
 * short-lived — other donors book while this form is open, and a window that filled
 * meanwhile should grey out before the donor submits into a SLOT_FULL.
 */
export function useDonationSlots(
	shelterCode: () => string,
	date: () => string,
	mode: () => DonationSlotMode | null
) {
	return createQuery(() => ({
		queryKey: ['public-donation-slots', shelterCode(), date(), mode()],
		queryFn: () => fetchDonationSlots(shelterCode(), date(), mode() ?? 'dropoff'),
		enabled: Boolean(shelterCode() && date() && mode()),
		staleTime: 30_000,
		// svelte-query v6 only notifies for props it has seen read ("tracked props"), and
		// reads are lazy. A consumer that gates UI on `isSuccess` / `isError` inside a
		// conditional block can read a prop for the first time AFTER the transition, and
		// is then handed a stale snapshot that never refreshes. Track every prop (the slot
		// picker reads isLoading / isError only once a shelter is chosen).
		notifyOnChangeProps: 'all'
	}));
}

export const donationQueueKeys = {
	all: ['donations', 'back-office-queue'] as const,
	/** One queue per active shelter: switching shelter must re-ask, not reuse the other's rows. */
	forShelter: (shelterCode: string | null) => [...donationQueueKeys.all, shelterCode] as const
};

/** The back-office "รายการของบริจาค" list (#617) — review and drop-off in one query. */
export function useDonationQueue() {
	return createQuery(() => {
		const shelterCode = resolveContextShelterCode();
		return {
			queryKey: donationQueueKeys.forShelter(shelterCode),
			queryFn: () => fetchDonationQueue(shelterCode)
		};
	});
}
