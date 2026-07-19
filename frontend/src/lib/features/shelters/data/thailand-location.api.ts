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
 * Hotfix: sourced from the BFF, whose server-side implementation currently
 * reads the bundled static JSON snapshot. Cached per session.
 */
export async function getAllLocations(): Promise<LocationRecord[]> {
	if (!cachedLocationData) {
		cachedLocationData = await serviceFetch<LocationRecord[]>(`${BASE}/all`);
	}
	return cachedLocationData;
}
