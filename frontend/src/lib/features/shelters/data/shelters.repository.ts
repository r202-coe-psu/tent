import type {
	AdmissionPolicy,
	AreaType,
	CommonAreas,
	Contact,
	Facilities,
	KeyPersonnel,
	Location,
	LuggagePolicy,
	OperationStatus,
	ParkingPolicy,
	ProjectLevel,
	Risk,
	SiteKind,
	Utilities,
	Zone
} from '../domain/schema';

/**
 * Read model for shelter list/detail — mirrors the back-office BFF GET shape.
 * Canonical definition; `shelters.api.ts` re-exports this type rather than
 * duplicating it, so a schema bump only needs to update this file + `masterToSummary()`.
 */
export interface ShelterBasic {
	code: string;
	name: string;
	site_kind: SiteKind;
	operation_status: OperationStatus;
	province: string | null;
	capacity: number;
}

export interface ShelterSummary {
	code: string;
	name: string;
	site_kind: SiteKind;
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

export interface SheltersRepository {
	listShelters(): Promise<ShelterSummary[]>;
	searchShelters(): Promise<ShelterBasic[]>;
	getShelter(code: string): Promise<ShelterSummary>;
}
