import { serviceFetch } from '$lib/api/service';
import {
	overviewDemographicsPayloadSchema,
	overviewFiltersToSearchParams,
	overviewMovementsPayloadSchema,
	overviewOriginPayloadSchema,
	overviewSitesPayloadSchema,
	overviewSummarySchema,
	preRegistrationProfileSchema,
	preRegistrationsListPayloadSchema,
	type OverviewDemographicsPayload,
	type OverviewFilters,
	type OverviewMovementsPayload,
	type OverviewOriginPayload,
	type OverviewSitesPayload,
	type OverviewSummary,
	type PreRegistrationProfile,
	type PreRegistrationsListPayload
} from '../domain/schemas';

function qs(filters: Partial<OverviewFilters>): string {
	const params = overviewFiltersToSearchParams(filters);
	const s = params.toString();
	return s ? `?${s}` : '';
}

export async function fetchOverviewSummary(
	filters: Partial<OverviewFilters> = {}
): Promise<OverviewSummary> {
	const data = await serviceFetch<OverviewSummary>(
		`/api/back-office/overview/summary${qs(filters)}`
	);
	return overviewSummarySchema.parse(data);
}

export async function fetchOverviewSites(
	filters: Partial<OverviewFilters> = {}
): Promise<OverviewSitesPayload> {
	const data = await serviceFetch<OverviewSitesPayload>(
		`/api/back-office/overview/sites${qs(filters)}`
	);
	return overviewSitesPayloadSchema.parse(data);
}

export async function fetchOverviewOrigin(
	filters: Partial<OverviewFilters> = {}
): Promise<OverviewOriginPayload> {
	const data = await serviceFetch<OverviewOriginPayload>(
		`/api/back-office/overview/by-origin${qs(filters)}`
	);
	return overviewOriginPayloadSchema.parse(data);
}

export async function fetchOverviewDemographics(
	filters: Partial<OverviewFilters> = {}
): Promise<OverviewDemographicsPayload> {
	const data = await serviceFetch<OverviewDemographicsPayload>(
		`/api/back-office/overview/demographics${qs(filters)}`
	);
	return overviewDemographicsPayloadSchema.parse(data);
}

export async function fetchOverviewMovements(
	filters: Partial<OverviewFilters> = {}
): Promise<OverviewMovementsPayload> {
	const data = await serviceFetch<OverviewMovementsPayload>(
		`/api/back-office/overview/movements${qs(filters)}`
	);
	return overviewMovementsPayloadSchema.parse(data);
}

export async function fetchPreRegistrations(
	filters: Partial<OverviewFilters> = {}
): Promise<PreRegistrationsListPayload> {
	const data = await serviceFetch<PreRegistrationsListPayload>(
		`/api/back-office/overview/pre-registrations${qs(filters)}`
	);
	return preRegistrationsListPayloadSchema.parse(data);
}

export async function fetchUnassignedProfile(id: string): Promise<PreRegistrationProfile> {
	const data = await serviceFetch<PreRegistrationProfile>(
		`/api/back-office/overview/pre-registrations/unassigned/${encodeURIComponent(id)}`
	);
	return preRegistrationProfileSchema.parse(data);
}

export async function fetchBoundEvacueeProfile(
	shelter: string,
	evacueeId: string
): Promise<PreRegistrationProfile> {
	const data = await serviceFetch<PreRegistrationProfile>(
		`/api/back-office/overview/pre-registrations/evacuee/${encodeURIComponent(shelter)}/${encodeURIComponent(evacueeId)}`
	);
	return preRegistrationProfileSchema.parse(data);
}
