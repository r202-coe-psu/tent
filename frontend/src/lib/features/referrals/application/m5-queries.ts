/**
 * TanStack Query hooks for the M5 dispatch mode (draft CR — referral M5 integration §2).
 */
import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { getShelterCode } from '$lib/db/shelter';
import {
	cancelM5BatchRemote,
	createM5BatchRemote,
	fetchIntegrationStatus,
	fetchM5Facilities,
	startM5BatchRemote,
	submitM5BatchRemote
} from '../data/referral.m5.remote';
import type { M5BatchInput } from '../domain/referral.m5';
import { referralKeys } from './queries';

/** Health gate refresh (CR §2): every 30 s, no retries — a failure is a gate state. */
const STATUS_REFETCH_MS = 30_000;
const FACILITIES_STALE_MS = 60_000;

export const m5Keys = {
	status: () => ['integrations', 'status', getShelterCode()] as const,
	facilities: (q: string) => ['integrations', 'm5', 'facilities', q] as const
};

export const useIntegrationStatus = () =>
	createQuery(() => ({
		queryKey: m5Keys.status(),
		queryFn: fetchIntegrationStatus,
		refetchInterval: STATUS_REFETCH_MS,
		retry: false
	}));

export const useM5Facilities = (q: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: m5Keys.facilities(q()),
		queryFn: () => fetchM5Facilities(q()),
		staleTime: FACILITIES_STALE_MS,
		retry: false,
		enabled: enabled()
	}));

function invalidate(queryClient: QueryClient) {
	void queryClient.invalidateQueries({ queryKey: referralKeys.all });
}

export const useCreateM5Batch = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: M5BatchInput) => createM5BatchRemote(input),
		onSuccess: () => invalidate(queryClient)
	}));

export const useSubmitM5Batch = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (batchId: string) => submitM5BatchRemote(batchId),
		onSettled: () => invalidate(queryClient)
	}));

export const useStartM5Batch = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (batchId: string) => startM5BatchRemote(batchId),
		onSettled: () => invalidate(queryClient)
	}));

export const useCancelM5Batch = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (v: { batchId: string; reason: string; resubmitWithout?: string[] }) =>
			cancelM5BatchRemote(v.batchId, v.reason, v.resubmitWithout),
		onSettled: () => invalidate(queryClient)
	}));
