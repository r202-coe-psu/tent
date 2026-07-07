import type {
	CommonAreas,
	Contact,
	Facilities,
	Location,
	OperationStatus,
	Risk,
	Utilities,
	Zone
} from '../domain/schema';

/** Read model for shelter list/detail — mirrors the back-office BFF GET shape. */
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

export interface SheltersRepository {
	listShelters(): Promise<ShelterSummary[]>;
	getShelter(code: string): Promise<ShelterSummary>;
}
