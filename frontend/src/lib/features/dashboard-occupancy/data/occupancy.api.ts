/**
 * data/occupancy.api.ts — dashboard-occupancy
 *
 * Client-side API caller for the back-office occupancy dashboard endpoint.
 * Never calls CouchDB directly — always goes through the SvelteKit BFF
 * (couchdb-pouchdb-bestpractices: rule 1 "Write to Local First / no direct CouchDB from UI").
 */
import type { OccupancyPayload } from '../domain/schema';

/**
 * Fetch occupancy statistics for a shelter from the BFF.
 *
 * @param shelterCode  e.g. 'SH001'
 * @throws on network errors or non-OK HTTP responses
 */
export async function fetchOccupancy(shelterCode: string): Promise<OccupancyPayload> {
	const res = await fetch(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/occupancy`,
		{ credentials: 'same-origin' }
	);
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: { message?: string } }).error?.message ??
				`Occupancy fetch failed (${res.status})`
		);
	}
	return res.json() as Promise<OccupancyPayload>;
}
