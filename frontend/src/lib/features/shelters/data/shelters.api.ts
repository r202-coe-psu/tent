import { serviceFetch } from '$lib/api/service';
import type {
	Shelter,
	Zone,
	Facilities,
	CommonAreas,
	Utilities,
	Risk,
	Location,
	Contact,
	OperationStatus
} from '../domain/schema';

const SHELTER_ENDPOINT = '/api/back-office/shelter';

export interface ShelterSummary {
	code: string;
	name: string;
	db: string;
	operation_status: OperationStatus;
	capacity: number;
	shelter_type: string | null;
	location: Location;
	contact: Contact;
	area_m2: number | null;
	area_type: string | null;
	facilities: Facilities;
	common_areas: CommonAreas;
	utilities: Utilities;
	risk: Risk;
	zones: Zone[];
}

export function listShelters(): Promise<ShelterSummary[]> {
	return serviceFetch<ShelterSummary[]>(SHELTER_ENDPOINT);
}

export function getShelter(code: string): Promise<ShelterSummary> {
	return serviceFetch<ShelterSummary>(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`);
}

export function createShelter(input: Shelter): Promise<{ ok: true; code: string }> {
	return serviceFetch(SHELTER_ENDPOINT, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function updateShelter(
	code: string,
	input: Partial<Shelter>
): Promise<{ ok: true; code: string }> {
	return serviceFetch(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`, {
		method: 'PATCH',
		body: JSON.stringify(input)
	});
}

export function closeZone(
	code: string,
	zoneCode: string,
	reason?: string
): Promise<{ ok: true; code: string; zoneCode: string; status: string }> {
	return serviceFetch(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/zones/${encodeURIComponent(zoneCode)}`,
		{
			method: 'POST',
			body: JSON.stringify({ action: 'close', reason })
		}
	);
}
