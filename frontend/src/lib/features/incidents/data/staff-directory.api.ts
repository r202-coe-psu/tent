import { serviceFetch } from '$lib/api/service';

export interface StaffDirectoryEntry {
	name: string;
	display_name: string | null;
}

/** Colleagues in a shelter (handover picker) — `GET /api/v1/shelters/{code}/staff`. */
export function listShelterStaff(shelterCode: string): Promise<StaffDirectoryEntry[]> {
	return serviceFetch<StaffDirectoryEntry[]>(
		`/api/v1/shelters/${encodeURIComponent(shelterCode)}/staff`
	);
}
