import { serviceFetch } from '$lib/api/service';

const BASE = '/api/v1/thailand-location';

export interface Subdistrict {
	subdistrict: string;
	zipcode: number;
}

export function listProvinces(): Promise<string[]> {
	return serviceFetch<string[]>(`${BASE}/provinces`);
}

export function listDistricts(province: string): Promise<string[]> {
	return serviceFetch<string[]>(`${BASE}/districts?province=${encodeURIComponent(province)}`);
}

export function listSubdistricts(province: string, district: string): Promise<Subdistrict[]> {
	return serviceFetch<Subdistrict[]>(
		`${BASE}/subdistricts?province=${encodeURIComponent(province)}&district=${encodeURIComponent(district)}`
	);
}

export interface LocationRecord {
	province: string;
	district: string;
	subdistrict: string;
	zipcode: number;
}

let cachedLocationData: LocationRecord[] | null = null;

/**
 * Full flat location list backing the household form's combined search-select.
 * CR-037: sourced from the BFF (`/api/v1/thailand-location/all` → CouchDB
 * `registry`) instead of the bundled 1.3 MB static JSON. Cached per session.
 */
export async function getAllLocations(): Promise<LocationRecord[]> {
	if (!cachedLocationData) {
		cachedLocationData = await serviceFetch<LocationRecord[]>(`${BASE}/all`);
	}
	return cachedLocationData;
}
