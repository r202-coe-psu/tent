/**
 * application/queries.ts — dashboard
 *
 * TanStack Query hooks + centralized query-key factory for the back-office
 * shelter dashboard (occupancy / demographics / registrations). The key factory
 * is the single source of truth for these cache keys — consumers (dashboard tab,
 * shelter list occupancy cell) must go through these hooks, never hardcode keys.
 */
import { createQuery } from '@tanstack/svelte-query';
import { fetchOccupancy } from '../data/occupancy.api';
import { fetchDemographics } from '../data/demographics.api';
import { fetchRegistrations } from '../data/registration.api';

const DASHBOARD_STALE_TIME = 60 * 1000; // 1 นาที

export const dashboardKeys = {
	all: ['dashboard'] as const,
	occupancy: (shelterCode: string) => [...dashboardKeys.all, 'occupancy', shelterCode] as const,
	demographics: (shelterCode: string) =>
		[...dashboardKeys.all, 'demographics', shelterCode] as const,
	registrations: (shelterCode: string, from?: string, to?: string) =>
		[...dashboardKeys.all, 'registrations', shelterCode, from ?? null, to ?? null] as const
};

export const useDashboardOccupancy = (code: () => string) =>
	createQuery(() => ({
		queryKey: dashboardKeys.occupancy(code()),
		queryFn: () => fetchOccupancy(code()),
		enabled: !!code(),
		staleTime: DASHBOARD_STALE_TIME
	}));

export const useDashboardDemographics = (code: () => string) =>
	createQuery(() => ({
		queryKey: dashboardKeys.demographics(code()),
		queryFn: () => fetchDemographics(code()),
		enabled: !!code(),
		staleTime: DASHBOARD_STALE_TIME
	}));

export const useDashboardRegistrations = (
	code: () => string,
	from?: () => string | undefined,
	to?: () => string | undefined
) =>
	createQuery(() => ({
		queryKey: dashboardKeys.registrations(code(), from?.(), to?.()),
		queryFn: () => fetchRegistrations(code(), from?.(), to?.()),
		enabled: !!code(),
		staleTime: DASHBOARD_STALE_TIME
	}));
