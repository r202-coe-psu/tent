import type { components } from '$lib/api/openapi';

export type FamilySearchResult = components['schemas']['SearchResult'];
export type FamilySearchResponse = components['schemas']['SearchResponse'];
export type PublicShelterItem = components['schemas']['ShelterItem'];
export type PublicShelterListResponse = components['schemas']['ShelterListResponse'];
export type PublicGeoPoint = components['schemas']['GeoPoint'];

/** UI list/map shape derived from the public shelters API (no occupancy). */
export type PublicShelterCardModel = {
	id: string;
	code: string;
	name: string;
	status: string;
	address: string;
	distance: number;
	capacity: number;
	province: string;
	district: string;
	subdistrict: string;
	geo: PublicGeoPoint | null;
};

export type ListPublicSheltersParams = {
	province?: string;
	district?: string;
	subdistrict?: string;
	status?: string;
};
