import { createQuery } from '@tanstack/svelte-query';
import type { OverviewFilters } from '../domain/schemas';
import {
	fetchBoundEvacueeProfile,
	fetchOverviewDemographics,
	fetchOverviewMovements,
	fetchOverviewOrigin,
	fetchOverviewSites,
	fetchOverviewSummary,
	fetchOverviewHouseholds,
	fetchPreRegistrations,
	fetchUnassignedProfile
} from '../data/overview.api';

export const overviewKeys = {
	all: ['system-overview'] as const,
	summary: (filters: Partial<OverviewFilters>) =>
		[...overviewKeys.all, 'summary', filters] as const,
	sites: (filters: Partial<OverviewFilters>) => [...overviewKeys.all, 'sites', filters] as const,
	origin: (filters: Partial<OverviewFilters>) => [...overviewKeys.all, 'origin', filters] as const,
	demographics: (filters: Partial<OverviewFilters>) =>
		[...overviewKeys.all, 'demographics', filters] as const,
	movements: (filters: Partial<OverviewFilters>) =>
		[...overviewKeys.all, 'movements', filters] as const,
	preRegs: (filters: Partial<OverviewFilters>) =>
		[...overviewKeys.all, 'pre-registrations', filters] as const,
	unassignedProfile: (id: string) => [...overviewKeys.all, 'unassigned', id] as const,
	boundProfile: (shelter: string, id: string) =>
		[...overviewKeys.all, 'bound', shelter, id] as const,
	households: (params: { scope?: string; shelterCode?: string | null; q?: string | null }) =>
		[...overviewKeys.all, 'households', params] as const
};

export function useOverviewSummary(getFilters: () => Partial<OverviewFilters>) {
	return createQuery(() => ({
		queryKey: overviewKeys.summary(getFilters()),
		queryFn: () => fetchOverviewSummary(getFilters())
	}));
}

export function useOverviewSites(getFilters: () => Partial<OverviewFilters>) {
	return createQuery(() => ({
		queryKey: overviewKeys.sites(getFilters()),
		queryFn: () => fetchOverviewSites(getFilters())
	}));
}

export function useOverviewOrigin(getFilters: () => Partial<OverviewFilters>) {
	return createQuery(() => ({
		queryKey: overviewKeys.origin(getFilters()),
		queryFn: () => fetchOverviewOrigin(getFilters())
	}));
}

export function useOverviewDemographics(getFilters: () => Partial<OverviewFilters>) {
	return createQuery(() => ({
		queryKey: overviewKeys.demographics(getFilters()),
		queryFn: () => fetchOverviewDemographics(getFilters())
	}));
}

export function useOverviewMovements(getFilters: () => Partial<OverviewFilters>) {
	return createQuery(() => ({
		queryKey: overviewKeys.movements(getFilters()),
		queryFn: () => fetchOverviewMovements(getFilters())
	}));
}

export function usePreRegistrations(getFilters: () => Partial<OverviewFilters>) {
	return createQuery(() => ({
		queryKey: overviewKeys.preRegs(getFilters()),
		queryFn: () => fetchPreRegistrations(getFilters()),
		staleTime: 10_000
	}));
}

export function useUnassignedProfile(getId: () => string) {
	return createQuery(() => ({
		queryKey: overviewKeys.unassignedProfile(getId()),
		queryFn: () => fetchUnassignedProfile(getId()),
		enabled: Boolean(getId())
	}));
}

export function useBoundEvacueeProfile(getShelter: () => string, getId: () => string) {
	return createQuery(() => ({
		queryKey: overviewKeys.boundProfile(getShelter(), getId()),
		queryFn: () => fetchBoundEvacueeProfile(getShelter(), getId()),
		enabled: Boolean(getShelter() && getId())
	}));
}

export function useOverviewHouseholds(
	getParams: () => {
		scope?: 'universal' | 'shelter';
		shelterCode?: string | null;
		q?: string | null;
		limit?: number;
	}
) {
	return createQuery(() => {
		const p = getParams();
		return {
			queryKey: overviewKeys.households(p),
			queryFn: () => fetchOverviewHouseholds(p),
			staleTime: 30_000
		};
	});
}
