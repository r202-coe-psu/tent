/**
 * TanStack Query hooks for the M5 dispatch mode (draft CR — referral M5 integration §2).
 */
import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import {
	cancelM5BatchRemote,
	createM5BatchRemote,
	fetchM5Facilities,
	startM5BatchRemote,
	submitM5BatchRemote
} from '../data/referral.m5.remote';
import type { M5BatchInput } from '../domain/referral.m5';
import { referralKeys } from './queries';

const FACILITIES_STALE_MS = 60_000;

export const m5Keys = {
	facilities: (q: string) => ['integrations', 'm5', 'facilities', q] as const
};

/** The shared health gate (`$lib/features/integrations`); re-exported for the M5 UI. */
export { useIntegrationStatus } from '$lib/features/integrations';

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
