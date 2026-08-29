import type { components } from '$lib/api/openapi';

export type FamilySearchResult = components['schemas']['SearchResult'];
export type FamilySearchResponse = components['schemas']['SearchResponse'];
export type PublicSiteKind = 'evacuation_center' | 'host_house';
export type PublicShelterItem = Omit<components['schemas']['ShelterItem'], 'site_kind'> & {
	site_kind?: PublicSiteKind;
	vulnerable_groups?: string[];
};
export type PublicShelterDetail = Omit<components['schemas']['ShelterDetail'], 'site_kind'> & {
	site_kind?: PublicSiteKind;
};
export type PublicShelterListResponse = Omit<
	components['schemas']['ShelterListResponse'],
	'shelters'
> & {
	shelters: PublicShelterItem[];
};
export type PublicGeoPoint = components['schemas']['GeoPoint'];

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
