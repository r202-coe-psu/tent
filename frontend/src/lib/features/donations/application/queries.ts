import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import type { DonationStatus } from '$lib/features/operations';
import {
	cancelDonation,
	fetchDonationTracking,
	searchDonationTracking,
	updateCourierTracking,
	updateDonationItems,
	type DonationItemEdit
} from '../data/public-tracking';
import {
	fetchDonationDetail,
	fetchDonationsByStatus,
	receiveDonationCount,
	type CountedLineInput
} from '../data/back-office-donations';

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

// ---------------------------------------------------------------- back-office intake

export const backOfficeDonationKeys = {
	all: ['donations', 'back-office'] as const,
	queue: (status: DonationStatus) => [...backOfficeDonationKeys.all, 'queue', status] as const,
	detail: (query: string) => [...backOfficeDonationKeys.all, 'detail', query] as const
};

/** The intake queue for one status — `verifying` backs the drop-off tab (CR-052 §1.2). */
export function useDonationQueue(status: () => DonationStatus) {
	return createQuery(() => ({
		queryKey: backOfficeDonationKeys.queue(status()),
		queryFn: () => fetchDonationsByStatus(status())
	}));
}

export function useBackOfficeDonation(query: () => string) {
	return createQuery(() => ({
		queryKey: backOfficeDonationKeys.detail(query()),
		queryFn: () => fetchDonationDetail(query()),
		enabled: Boolean(query().trim()),
		retry: false
	}));
}

export function useReceiveDonationCount() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { query: string; items: CountedLineInput[]; remarks?: string }) =>
			receiveDonationCount(input),
		// The booking leaves the queue and the ledger gains rows — refetch rather than
		// patch, so the list and the stock views agree on what the server actually wrote.
		onSuccess: () => queryClient.invalidateQueries({ queryKey: backOfficeDonationKeys.all })
	}));
}
