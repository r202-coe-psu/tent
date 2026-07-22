import { publicClient } from '$lib/api/public-client';
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
	const { data, error, response } = await publicClient.POST('/public/v1/family-search', {
		body: { search: query }
	});
	if (error || !data) {
		throw publicApiError(error, response.status, 'เกิดข้อผิดพลาดในการค้นหา');
	}
	return data;
}

export async function listPublicShelters(
	params: ListPublicSheltersParams = {}
): Promise<PublicShelterListResponse> {
	const { data, error, response } = await publicClient.GET('/public/v1/shelters', {
		params: {
			query: {
				province: params.province || null,
				district: params.district || null,
				subdistrict: params.subdistrict || null,
				status: params.status || null
			}
		}
	});
	if (error || !data) {
		throw publicApiError(error, response.status, 'ไม่สามารถโหลดรายการศูนย์พักพิงได้');
	}
	return data;
}
