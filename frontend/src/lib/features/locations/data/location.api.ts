import { serviceFetch } from '$lib/api/service';

/**
 * Client HTTP for Thailand location data (CR-037).
 * Reads: `/api/v1/thailand-location/*` (any authenticated user).
 * Writes: `/api/back-office/thailand-location` (SA-only, dev BFF).
 */

const READ_BASE = '/api/v1/thailand-location';
const WRITE_BASE = '/api/back-office/thailand-location';

export interface SubdistrictEntry {
	subdistrict: string;
	zipcode: number;
}

export function listProvinces(): Promise<string[]> {
	return serviceFetch<string[]>(`${READ_BASE}/provinces`);
}

export function listDistricts(province: string): Promise<string[]> {
	return serviceFetch<string[]>(`${READ_BASE}/districts?province=${encodeURIComponent(province)}`);
}

export function listSubdistricts(province: string, district: string): Promise<SubdistrictEntry[]> {
	return serviceFetch<SubdistrictEntry[]>(
		`${READ_BASE}/subdistricts?province=${encodeURIComponent(province)}&district=${encodeURIComponent(district)}`
	);
}

export function createProvince(name: string): Promise<{ ok: true }> {
	return serviceFetch(`${WRITE_BASE}`, {
		method: 'POST',
		body: JSON.stringify({ level: 'province', name })
	});
}

export function createDistrict(province: string, name: string): Promise<{ ok: true }> {
	return serviceFetch(`${WRITE_BASE}`, {
		method: 'POST',
		body: JSON.stringify({ level: 'district', province, name })
	});
}

export function createSubdistrict(
	province: string,
	district: string,
	name: string,
	zipcode: number
): Promise<{ ok: true }> {
	return serviceFetch(`${WRITE_BASE}`, {
		method: 'POST',
		body: JSON.stringify({ level: 'subdistrict', province, district, name, zipcode })
	});
}

export function updateSubdistrictZipcode(id: string, zipcode: number): Promise<{ ok: true }> {
	return serviceFetch(`${WRITE_BASE}`, {
		method: 'PUT',
		body: JSON.stringify({ id, zipcode })
	});
}

export function deleteLocation(id: string): Promise<{ ok: true }> {
	return serviceFetch(`${WRITE_BASE}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}
