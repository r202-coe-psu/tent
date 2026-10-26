import type { StationId } from '$lib/tokens/colors';
import { PORTAL_DEPARTMENTS } from './portal-menu';

export type OnsiteStation = {
	id: StationId;
	label: string;
	path: string;
};

function stationsFromMenu(): readonly OnsiteStation[] {
	const found: OnsiteStation[] = [];
	for (const dept of PORTAL_DEPARTMENTS) {
		for (const item of dept.items) {
			if (item.station == null || typeof item.href !== 'string') continue;
			found.push({ id: item.station, label: item.label, path: item.href });
		}
	}
	return found.sort((a, b) => a.id - b.id);
}

/** The three onsite stations, read off the portal menu so labels and routes never drift. */
export const ONSITE_STATIONS = stationsFromMenu();

/**
 * Which station page a pathname belongs to, or `null` for the onsite hub and the shared tools.
 * Matches the station route and everything nested under it (`/onsite/zoning/<evacuee_id>`).
 */
export function resolveOnsiteStation(pathname: string): OnsiteStation | null {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	for (const station of ONSITE_STATIONS) {
		if (path === station.path || path.startsWith(`${station.path}/`)) return station;
	}
	return null;
}
