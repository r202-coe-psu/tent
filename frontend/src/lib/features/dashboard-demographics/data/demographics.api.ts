/**
 * data/demographics.api.ts — dashboard-demographics
 *
 * Client-side API caller for the back-office demographics dashboard endpoint.
 * Never calls CouchDB directly from the browser.
 */
import type { DemographicsPayload } from '../domain/schema';

/**
 * Fetch age-group and nationality statistics for a shelter from the BFF.
 *
 * @param shelterCode  e.g. 'SH001'
 * @throws on network errors or non-OK HTTP responses
 */
export async function fetchDemographics(shelterCode: string): Promise<DemographicsPayload> {
	const res = await fetch(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/demographics`,
		{ credentials: 'same-origin' }
	);
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: { message?: string } }).error?.message ??
				`Demographics fetch failed (${res.status})`
		);
	}
	return res.json() as Promise<DemographicsPayload>;
}
