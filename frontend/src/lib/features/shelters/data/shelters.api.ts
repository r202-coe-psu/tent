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
	OperationStatus,
	ProjectLevel,
	AreaType,
	KeyPersonnel,
	AdmissionPolicy,
	LuggagePolicy,
	ParkingPolicy
} from '../domain/schema';

const SHELTER_ENDPOINT = '/api/back-office/shelter';

export interface ShelterSummary {
	code: string;
	name: string;
	db: string;
	operation_status: OperationStatus;
	capacity: number;
	shelter_type: string | null;
	project_level: ProjectLevel | null;
	location: Location;
	contact: Contact;
	municipality_zone: string | null;
	community: string | null;
	address_no: string | null;
	village_no: string | null;
	subdistrict: string | null;
	district: string | null;
	province: string | null;
	postal_code: string | null;
	key_personnel: KeyPersonnel | null;
	area_m2: number | null;
	area_type: AreaType | string | null;
	facilities: Facilities;
	common_areas: CommonAreas;
	utilities: Utilities;
	risk: Risk;
	zones: Zone[];
	admission_policy: AdmissionPolicy;
	luggage_policy: LuggagePolicy;
	parking_policy: ParkingPolicy;
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
	reason?: string,
	closedBy?: string
): Promise<{ ok: true; code: string; zoneCode: string; status: string }> {
	return serviceFetch(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/zones/${encodeURIComponent(zoneCode)}`,
		{
			method: 'POST',
			body: JSON.stringify({ reason, closed_by: closedBy })
		}
	);
}

export function reopenZone(
	code: string,
	zoneCode: string,
	reopenedBy?: string
): Promise<{ ok: true; code: string; zoneCode: string; status: string }> {
	return serviceFetch(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/zones/${encodeURIComponent(zoneCode)}/reopen`,
		{
			method: 'POST',
			body: JSON.stringify({ reopened_by: reopenedBy })
		}
	);
}
