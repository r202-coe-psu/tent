/**
 * data/demographics.api.ts — dashboard-demographics
 *
 * Client-side API caller for the back-office demographics dashboard endpoint.
 * Never calls CouchDB directly from the browser.
 */
import type { DemographicsPayload } from '../domain/demographics.schema';
import { serviceFetch } from '$lib/api/service';

/**
 * Fetch age-group and nationality statistics for a shelter from the BFF.
 *
 * @param shelterCode  e.g. 'SH001'
 * @throws on network errors or non-OK HTTP responses
 */
export async function fetchDemographics(shelterCode: string): Promise<DemographicsPayload> {
	return serviceFetch<DemographicsPayload>(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/demographics`
	);
}
