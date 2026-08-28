/**
 * Public portal data access — browser calls same-origin BFF `/api/public/v1/*` only.
 * FastAPI `/public/v1/*` requires EXTERNAL_API_SECRET (injected by BFF). Never use
 * `/public-api` from the client (CR-063).
 */
import type {
	FamilySearchResponse,
	ListPublicSheltersParams,
	PublicShelterListResponse
} from '../domain/types';

function publicApiError(error: unknown, status: number, fallback: string): Error {
	if (error && typeof error === 'object' && 'error' in error) {
		const body = error as { error?: { message?: string } };
		if (body.error?.message) return new Error(body.error.message);
	}
	return new Error(fallback || `Request failed (${status})`);
}

export async function familySearch(query: string): Promise<FamilySearchResponse> {
	const response = await fetch('/api/public/v1/occupants', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ search: query })
	});
	const data = await response.json().catch(() => null);
	if (!response.ok || !data) {
		throw publicApiError(data, response.status, 'เกิดข้อผิดพลาดในการค้นหา');
	}
	return data as FamilySearchResponse;
}

export async function listPublicShelters(
	params: ListPublicSheltersParams = {}
): Promise<PublicShelterListResponse> {
	const url = new URL('/api/public/v1/shelters', 'http://local.invalid');
	if (params.province) url.searchParams.set('province', params.province);
	if (params.district) url.searchParams.set('district', params.district);
	if (params.subdistrict) url.searchParams.set('subdistrict', params.subdistrict);
	if (params.status) url.searchParams.set('status', params.status);
	if (params.site_kind) url.searchParams.set('site_kind', params.site_kind);
	if (params.lat !== undefined && !Number.isNaN(params.lat))
		url.searchParams.set('lat', params.lat.toString());
	if (params.lng !== undefined && !Number.isNaN(params.lng))
		url.searchParams.set('lng', params.lng.toString());
	if (params.radius_km !== undefined && !Number.isNaN(params.radius_km) && params.radius_km > 0) {
		url.searchParams.set('radius_km', params.radius_km.toString());
	}

	const fetchFn = params.fetch ?? fetch;
	const response = await fetchFn(`${url.pathname}${url.search}`);
	const data = await response.json().catch(() => null);
	if (!response.ok || !data) {
		throw publicApiError(data, response.status, 'ไม่สามารถโหลดรายการศูนย์พักพิงได้');
	}
	return data as PublicShelterListResponse;
}

export type MasterLabelOption = { code: string; label: string };

/**
 * Code → label for `master_data:vulnerable_group`. Degrades to `[]` on any
 * failure — shelter cards must still render without the badge text.
 */
export async function fetchVulnerableGroupLabels(
	fetchFn: typeof fetch = fetch
): Promise<MasterLabelOption[]> {
	try {
		const response = await fetchFn('/api/public/v1/config/vulnerable-groups');
		if (!response.ok) return [];
		const body = (await response.json().catch(() => null)) as {
			groups?: MasterLabelOption[];
		} | null;
		return body?.groups ?? [];
	} catch {
		return [];
	}
}

/**
 * Code → label for `master_data:shelter_type` (public field `admin_type`).
 * Same degrade-to-empty contract as vulnerable groups.
 */
export async function fetchShelterTypeLabels(
	fetchFn: typeof fetch = fetch
): Promise<MasterLabelOption[]> {
	try {
		const response = await fetchFn('/api/public/v1/config/shelter-types');
		if (!response.ok) return [];
		const body = (await response.json().catch(() => null)) as {
			types?: MasterLabelOption[];
		} | null;
		return body?.types ?? [];
	} catch {
		return [];
	}
}
