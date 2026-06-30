/**
 * data/registration.api.ts — dashboard-registration
 *
 * Client-side API caller for the back-office registrations dashboard endpoint.
 * Never calls CouchDB directly from the browser.
 */
import type { RegistrationsPayload } from '../domain/schema';
import { serviceFetch } from '$lib/api/service';

/**
 * Fetch daily registration statistics for a shelter from the BFF.
 *
 * @param shelterCode  e.g. 'SH001'
 * @param from         Optional inclusive start date (YYYY-MM-DD). Defaults to 30 days ago.
 * @param to           Optional inclusive end date (YYYY-MM-DD). Defaults to today.
 * @throws on network errors or non-OK HTTP responses
 */
export async function fetchRegistrations(
	shelterCode: string,
	from?: string,
	to?: string
): Promise<RegistrationsPayload> {
	const params = new URLSearchParams();
	if (from) params.set('from', from);
	if (to) params.set('to', to);
	
	const query = params.toString() ? `?${params.toString()}` : '';
	return serviceFetch<RegistrationsPayload>(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/registrations${query}`
	);
}
