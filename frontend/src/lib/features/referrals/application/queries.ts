import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { getShelterCode, getShelterDb } from '$lib/db/shelter';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import {
	listReferrals,
	getReferral,
	createReferral,
	transitionReferral
} from '../data/referral.api';
import type { ReferralInput, ReferralStatus } from '../domain/referral.schema';

export const referralKeys = {
	all: ['referrals'] as const,
	lists: () => [...referralKeys.all, 'list', getShelterCode()] as const,
	list: (filter?: { status?: ReferralStatus; evacuee_id?: string }) =>
		[...referralKeys.lists(), filter] as const,
	details: () => [...referralKeys.all, 'detail', getShelterCode()] as const,
	detail: (id: string) => [...referralKeys.details(), id] as const
};

export const useReferrals = (filter?: { status?: ReferralStatus; evacuee_id?: string }) =>
	createQuery(() => ({
		queryKey: referralKeys.list(filter),
		queryFn: () => listReferrals(filter)
	}));

export const useReferral = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: referralKeys.detail(id()),
		queryFn: () => getReferral(id()),
		enabled: enabled() && !!id()
	}));

export const useCreateReferral = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: ReferralInput) => createReferral(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: referralKeys.all });
		}
	}));

export const useTransitionReferral = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({ id, to }: { id: string; to: ReferralStatus }) => transitionReferral(id, to),
		onSuccess: () => {
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
