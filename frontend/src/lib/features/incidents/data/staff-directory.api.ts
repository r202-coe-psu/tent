import { serviceFetch } from '$lib/api/service';

export interface StaffDirectoryEntry {
	name: string;
	display_name: string | null;
}

/** Colleagues in a shelter (handover picker) — `GET /api/v1/shelters/{code}/staff`. */
export function listShelterStaff(
	shelterCode: string,
	capabilities?: readonly string[]
): Promise<StaffDirectoryEntry[]> {
	const query = capabilities?.length
		? `?capabilities=${encodeURIComponent(capabilities.join(','))}`
		: '';
	return serviceFetch<StaffDirectoryEntry[]>(
		`/api/v1/shelters/${encodeURIComponent(shelterCode)}/staff${query}`
	);
}
