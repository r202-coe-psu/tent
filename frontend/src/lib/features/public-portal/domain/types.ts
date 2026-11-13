import type { components } from '$lib/api/openapi';

export type FamilySearchResult = components['schemas']['SearchResult'];
export type FamilySearchResponse = components['schemas']['SearchResponse'];
/** `master_data:site_kind` code (CR-198) — `evacuation_center`, `host_house`, or any code SA adds. */
export type PublicSiteKind = string;
export type PublicShelterItem = Omit<components['schemas']['ShelterItem'], 'site_kind'> & {
	site_kind?: PublicSiteKind;
	vulnerable_groups?: string[];
};
export type PublicShelterDetail = Omit<components['schemas']['ShelterDetail'], 'site_kind'> & {
	site_kind?: PublicSiteKind;
	code?: string;
};
export type PublicShelterListResponse = Omit<
	components['schemas']['ShelterListResponse'],
	'shelters'
> & {
	shelters: PublicShelterItem[];
};
export type PublicGeoPoint = components['schemas']['GeoPoint'];
/** One ticked storage point of a shelter detail (CR-205 FR-DP-12). */
export type PublicDonationPoint = components['schemas']['DonationPoint'];
/** One pinned parking point of a shelter (CR-253 FR-25): name, note, geo, vehicles + capacity. */
export type PublicParkingPoint = components['schemas']['ParkingPoint'];

/** UI list/map shape derived from the public shelters API (no occupancy). */
export type PublicShelterCardModel = {
	id: string;
	code: string;
	name: string;
	site_kind: PublicSiteKind;
	status: string;
	address: string;
	distance: number;
	capacity: number;
	province: string;
	district: string;
	subdistrict: string;
	pet_policy: string | null;
	vulnerable_groups: string[] | null;
	admin_type: string | null;
	geo: PublicGeoPoint | null;
	accepts_pre_registration: boolean;
	/** Pinned parking points; `[]` when the shelter has none (CR-253 FR-28). */
	parking_points: PublicParkingPoint[];
	/** Vehicle types the shelter takes, in motorcycle/car/truck/boat order (CR-253 FR-35). */
	parking_vehicle_types: string[];
};

export type ListPublicSheltersParams = {
	province?: string;
	district?: string;
	subdistrict?: string;
	status?: string;
	site_kind?: PublicSiteKind;
	lat?: number;
	lng?: number;
	radius_km?: number;
	fetch?: typeof globalThis.fetch;
};
