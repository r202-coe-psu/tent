/**
 * data/station-times.api.ts — dashboard station service time (CR-192)
 *
 * Client-side API caller for the back-office station-times dashboard endpoint.
 * Never calls CouchDB directly from the browser.
 */
import type { StationTimesPayload } from '../domain/station-times.schema';
import { serviceFetch } from '$lib/api/service';

/**
 * Fetch per-station service time summary for a shelter from the BFF.
 *
 * @param shelterCode  e.g. 'SH001'
 * @param from         Optional inclusive start date (YYYY-MM-DD). Defaults to the day the shelter was created.
 * @param to           Optional inclusive end date (YYYY-MM-DD). Defaults to today.
 * @throws on network errors or non-OK HTTP responses
 */
export async function fetchStationTimes(
	shelterCode: string,
	from?: string,
	to?: string
): Promise<StationTimesPayload> {
	const params = new URLSearchParams();
	if (from) params.set('from', from);
	if (to) params.set('to', to);

	const query = params.toString() ? `?${params.toString()}` : '';
	return serviceFetch<StationTimesPayload>(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/station-times${query}`
	);
}
