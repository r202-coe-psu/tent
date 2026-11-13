/**
 * TanStack Query hook for the shared integration health gate (draft CR — referral M5 §2,
 * central warehouse M6 §4).
 */
import { createQuery } from '@tanstack/svelte-query';
import { getShelterCode } from '$lib/db/shelter';
import { fetchIntegrationStatus } from '../data/integration-status.remote';

/** Health gate refresh: every 30 s, no retries — a failure is a gate state. */
const STATUS_REFETCH_MS = 30_000;

export const integrationKeys = {
	status: () => ['integrations', 'status', getShelterCode()] as const
};

/** The full `{ m5, m6 }` answer; callers read the system they gate on. */
export const useIntegrationStatus = () =>
	createQuery(() => ({
		queryKey: integrationKeys.status(),
		queryFn: fetchIntegrationStatus,
		refetchInterval: STATUS_REFETCH_MS,
		retry: false
	}));
