/**
 * Public portal data access — browser calls same-origin BFF `/api/public/v1/*` only.
 * FastAPI `/public/v1/*` requires EXTERNAL_API_SECRET (injected by BFF). Never use
 * `/public-api` from the client (CR-063).
 */
import type {
	FamilySearchResponse,
	ListPublicSheltersParams,
	PublicShelterDetail,
	PublicShelterListResponse,
	PublicShelterSummary
} from '../domain/types';
import type { SearchConsent } from '../domain/search-consent';
import type { MasterLabelOption } from '../domain/master-labels';
import type { SiteKindOption } from '../domain/site-kind';
import { classifyPublicApiError, type PublicApiErrorKind } from '../domain/search-error';

const SEARCH_FALLBACK = 'เกิดข้อผิดพลาดในการค้นหา';

/** Thai default copy per kind; UI layers re-map `kind` to the active language. */
const SEARCH_ERROR_MESSAGES: Partial<Record<PublicApiErrorKind, string>> = {
	validation: 'กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก',
	rateLimited: 'ค้นหาบ่อยเกินไป ลองใหม่ภายหลัง',
	unavailable: 'ระบบค้นหาไม่พร้อมใช้งานชั่วคราว'
};

export class PublicApiError extends Error {
	readonly kind: PublicApiErrorKind;

	constructor(kind: PublicApiErrorKind, message: string) {
		super(message);
		this.name = 'PublicApiError';
		this.kind = kind;
	}
}

/** Never surfaces backend text — only `kind`-based copy, else `fallback`. */
export function publicApiError(
	body: unknown,
	status: number,
	fallback: string,
	messages: Partial<Record<PublicApiErrorKind, string>> = {}
): PublicApiError {
	const kind = classifyPublicApiError(body, status);
	return new PublicApiError(kind, messages[kind] ?? (fallback || `Request failed (${status})`));
}

/** CR-231: every search carries the searcher, purpose and consent (FR-6). */
export async function familySearch(
	query: string,
	consent: SearchConsent
): Promise<FamilySearchResponse> {
	let response: Response;
	try {
		response = await fetch('/api/public/v1/occupants', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ search: query, ...consent })
		});
	} catch {
		throw new PublicApiError('unavailable', SEARCH_ERROR_MESSAGES.unavailable ?? '');
	}
	const data = await response.json().catch(() => null);
	if (!response.ok || !data) {
		throw publicApiError(data, response.status, SEARCH_FALLBACK, SEARCH_ERROR_MESSAGES);
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
	// These run in the database, not in the browser (#1419).
	if (params.q?.trim()) url.searchParams.set('q', params.q.trim());
	if (params.admin_type) url.searchParams.set('admin_type', params.admin_type);
	if (params.hide_full) url.searchParams.set('hide_full', 'true');
	if (params.hide_evacuation) url.searchParams.set('hide_evacuation', 'true');
	if (params.hide_external) url.searchParams.set('hide_external', 'true');
	if (params.hide_host_house) url.searchParams.set('hide_host_house', 'true');
	for (const type of params.parking ?? []) url.searchParams.append('parking', type);

	const fetchFn = params.fetch ?? fetch;
	const response = await fetchFn(`${url.pathname}${url.search}`);
	const data = await response.json().catch(() => null);
	if (!response.ok || !data) {
		throw publicApiError(data, response.status, 'ไม่สามารถโหลดรายการศูนย์พักพิงได้');
	}
	return data as PublicShelterListResponse;
}

/**
 * Head counts for the `/shelters` cards. They ignore the list filters, so the numbers hold still
 * while a visitor searches. `hide_host_house` leaves out the host houses the page never lists.
 */
export async function fetchShelterSummary(
	options: { hide_host_house?: boolean; fetch?: typeof globalThis.fetch } = {}
): Promise<PublicShelterSummary> {
	const url = new URL('/api/public/v1/shelters/summary', 'http://local.invalid');
	if (options.hide_host_house) url.searchParams.set('hide_host_house', 'true');

	const fetchFn = options.fetch ?? fetch;
	const response = await fetchFn(`${url.pathname}${url.search}`);
	const data = await response.json().catch(() => null);
	if (!response.ok || !data) {
		throw publicApiError(data, response.status, 'ไม่สามารถโหลดจำนวนศูนย์พักพิงได้');
	}
	return data as PublicShelterSummary;
}

/** Single shelter by code. Throws `PublicApiError` on 404 / 503 so callers can degrade. */
export async function getPublicShelter(
	code: string,
	fetchFn: typeof fetch = fetch
): Promise<PublicShelterDetail> {
	let response: Response;
	try {
		response = await fetchFn(`/api/public/v1/shelters/${encodeURIComponent(code)}`);
	} catch {
		throw new PublicApiError('unavailable', 'ไม่สามารถโหลดข้อมูลศูนย์พักพิงได้');
	}
	const data = (await response.json().catch(() => null)) as {
		shelter?: PublicShelterDetail;
	} | null;
	if (!response.ok || !data?.shelter) {
		throw publicApiError(data, response.status, 'ไม่สามารถโหลดข้อมูลศูนย์พักพิงได้');
	}
	return data.shelter;
}

export type { MasterLabelOption };

/**
 * Bilingual options for `master_data:vulnerable_group`. Degrades to `[]` on any
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
 * Bilingual options for `master_data:shelter_type` (public field `admin_type`).
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
			shelterTypes?: MasterLabelOption[];
		} | null;
		return body?.types ?? body?.shelterTypes ?? [];
	} catch {
		return [];
	}
}

/**
 * Bilingual options for `master_data:site_kind` (public field `site_kind`),
 * every status included — see the BFF for why `inactive` items are kept.
 */
export async function fetchSiteKinds(fetchFn: typeof fetch = fetch): Promise<SiteKindOption[]> {
	try {
		const response = await fetchFn('/api/public/v1/config/site-kinds');
		if (!response.ok) return [];
		const body = (await response.json().catch(() => null)) as { types?: SiteKindOption[] } | null;
		return body?.types ?? [];
	} catch {
		return [];
	}
}

export { fetchShelterTypeLabels as fetchShelterTypes, type MasterLabelOption as ShelterTypeOption };
