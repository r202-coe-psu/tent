import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { getShelterCode, getShelterDb } from '$lib/db/shelter';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { createReferralBatch, referralRepository } from '../data/referral.remote';
import type { ReferralSubmitIntent } from '../data/referral.repository';
import { authStore } from '$lib/stores/auth.svelte';
import type {
	Referral,
	ReferralFilter,
	ReferralInput,
	ReferralStatus
} from '../domain/referral.schema';

export const referralKeys = {
	all: ['referrals'] as const,
	lists: () => [...referralKeys.all, 'list', getShelterCode()] as const,
	list: (filter?: ReferralFilter) => [...referralKeys.lists(), filter] as const,
	details: () => [...referralKeys.all, 'detail', getShelterCode()] as const,
	detail: (id: string) => [...referralKeys.details(), id] as const
};

export const useReferrals = (filter?: ReferralFilter) =>
	createQuery(() => ({
		queryKey: referralKeys.list(filter),
		queryFn: () => referralRepository().list(filter)
	}));

export const useReferral = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: referralKeys.detail(id()),
		queryFn: () => referralRepository().get(id()),
		enabled: enabled() && !!id()
	}));

export const useCreateReferral = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: ReferralInput) =>
			referralRepository().create(input, {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

export const useCreateReferralBatch = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({
			template,
			evacueeIds,
			intent
		}: {
			template: ReferralInput;
			evacueeIds: string[];
			intent: ReferralSubmitIntent;
		}) =>
			createReferralBatch(template, evacueeIds, {
				intent,
				ctx: {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				}
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

export const useTransitionReferral = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({ id, to, reason }: { id: string; to: ReferralStatus; reason?: string }) =>
			referralRepository().transition(id, to, authStore.user?.name ?? 'unknown', reason),
		onSuccess: (updatedDoc) => {
			// 1. Update detail cache instantly
			queryClient.setQueryData(referralKeys.detail(updatedDoc._id), updatedDoc);

			// 2. Update list caches (if any exist) — replace matching doc with updated
			queryClient.setQueriesData<Referral[]>(
				{ queryKey: referralKeys.lists() },
				(oldList) => oldList?.map((r) => (r._id === updatedDoc._id ? updatedDoc : r)) ?? oldList
			);

			// 3. Background invalidate to ensure eventual consistency with CouchDB sync
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

export function startReferralsLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (type === 'referral') {
			return [referralKeys.all];
		}
		return [];
	});
}
