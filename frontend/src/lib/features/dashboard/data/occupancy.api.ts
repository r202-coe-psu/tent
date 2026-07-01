/**
 * data/occupancy.api.ts — dashboard-occupancy
 *
 * Client-side API caller for the back-office occupancy dashboard endpoint.
 * Never calls CouchDB directly — always goes through the SvelteKit BFF
 * (couchdb-pouchdb-bestpractices: rule 1 "Write to Local First / no direct CouchDB from UI").
 */
import type { OccupancyPayload } from '../domain/occupancy.schema';
import { serviceFetch } from '$lib/api/service';

/**
 * Fetch occupancy statistics for a shelter from the BFF.
 *
 * @param shelterCode  e.g. 'SH001'
 * @throws on network errors or non-OK HTTP responses
 */
export async function fetchOccupancy(shelterCode: string): Promise<OccupancyPayload> {
	return serviceFetch<OccupancyPayload>(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/occupancy`
	);
}
