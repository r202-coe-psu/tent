/**
 * application/queries.ts — dashboard
 *
 * TanStack Query hooks + centralized query-key factory for the back-office
 * shelter dashboard (occupancy / demographics / registrations). The key factory
 * is the single source of truth for these cache keys — consumers (dashboard tab,
 * shelter list occupancy cell) must go through these hooks, never hardcode keys.
 */
import { createQuery, keepPreviousData } from '@tanstack/svelte-query';
import { fetchOccupancy } from '../data/occupancy.api';
import { fetchDemographics } from '../data/demographics.api';
import { fetchRegistrations } from '../data/registration.api';
import { fetchStationTimes } from '../data/station-times.api';

const DASHBOARD_STALE_TIME = 60 * 1000; // 1 นาที

export const dashboardKeys = {
	all: ['dashboard'] as const,
	occupancy: (shelterCode: string) => [...dashboardKeys.all, 'occupancy', shelterCode] as const,
	demographics: (shelterCode: string) =>
		[...dashboardKeys.all, 'demographics', shelterCode] as const,
	registrations: (shelterCode: string, from?: string, to?: string) =>
		[...dashboardKeys.all, 'registrations', shelterCode, from ?? null, to ?? null] as const,
	stationTimes: (shelterCode: string, from?: string, to?: string) =>
		[...dashboardKeys.all, 'stationTimes', shelterCode, from ?? null, to ?? null] as const
};

export const useDashboardOccupancy = (code: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: dashboardKeys.occupancy(code()),
		queryFn: () => fetchOccupancy(code()),
		enabled: !!code() && enabled(),
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
		staleTime: DASHBOARD_STALE_TIME,
		// Keep the current chart on screen while a new range loads (CR-170 FR-6).
		placeholderData: keepPreviousData
	}));

export const useDashboardStationTimes = (
	code: () => string,
	from?: () => string | undefined,
	to?: () => string | undefined
) =>
	createQuery(() => ({
		queryKey: dashboardKeys.stationTimes(code(), from?.(), to?.()),
		queryFn: () => fetchStationTimes(code(), from?.(), to?.()),
		enabled: !!code(),
		staleTime: DASHBOARD_STALE_TIME,
		// Keep the current numbers on screen while a new range loads (CR-170 FR-6).
		placeholderData: keepPreviousData
	}));
