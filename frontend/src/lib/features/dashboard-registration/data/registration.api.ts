/**
 * data/registration.api.ts — dashboard-registration
 *
 * Client-side API caller for the back-office registrations dashboard endpoint.
 * Never calls CouchDB directly from the browser.
 */
import type { RegistrationsPayload } from '../domain/schema';

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
	const url = new URL(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/registrations`,
		location.origin
	);
	if (from) url.searchParams.set('from', from);
	if (to) url.searchParams.set('to', to);

	const res = await fetch(url.toString(), { credentials: 'same-origin' });
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: { message?: string } }).error?.message ??
				`Registrations fetch failed (${res.status})`
		);
	}
	return res.json() as Promise<RegistrationsPayload>;
}
