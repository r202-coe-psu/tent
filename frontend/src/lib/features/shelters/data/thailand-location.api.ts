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
