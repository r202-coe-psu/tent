/**
 * data/zone-occupancy.api.ts — dashboard per-zone occupancy (CR-226)
 *
 * Client-side caller for the back-office zones dashboard endpoint.
 * Never calls CouchDB directly from the browser.
 */
import type { ZoneOccupancyPayload } from '../domain/zone-occupancy.schema';
import { serviceFetch } from '$lib/api/service';

export async function fetchZoneOccupancy(shelterCode: string): Promise<ZoneOccupancyPayload> {
	return serviceFetch<ZoneOccupancyPayload>(
		`/api/back-office/shelter/${encodeURIComponent(shelterCode)}/dashboard/zones`
	);
}
