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

export async function getAllLocations(): Promise<LocationRecord[]> {
	if (!cachedLocationData) {
		const res = await fetch('/data/thailand_location_data.json');
		if (!res.ok) throw new Error('Failed to load location data');
		cachedLocationData = (await res.json()) as LocationRecord[];
	}
	return cachedLocationData;
}
