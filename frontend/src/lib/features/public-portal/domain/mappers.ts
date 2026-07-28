import type { FamilySearchResult, PublicShelterCardModel, PublicShelterItem } from './types';

/** Normalize Mongo/API status for existing public UI color helpers. */
export function toUiShelterStatus(status: string): string {
	const s = status.trim().toLowerCase();
	if (s === 'open') return 'OPEN';
	if (s === 'full') return 'FULL';
	if (s === 'prepare' || s === 'preparing' || s === 'ready') return 'PREPARE';
	if (s === 'closed') return 'CLOSED';
	return status.toUpperCase();
}

export function isInShelterStatus(status: string): boolean {
	return status === 'in_shelter';
}

export function toPublicShelterCard(item: PublicShelterItem, distance = 0): PublicShelterCardModel {
	const parts = [item.subdistrict, item.district, item.province].filter(Boolean);
	return {
		id: item.code,
		code: item.code,
		name: item.name,
		status: toUiShelterStatus(item.status),
		address: parts.length > 0 ? parts.join(' ') : item.code,
		distance,
		capacity: item.capacity ?? 0,
		province: item.province ?? '',
		district: item.district ?? '',
		subdistrict: item.subdistrict ?? '',
		pet_policy: item.pet_policy ?? null,
		vulnerable_groups: item.vulnerable_groups ?? null,
		admin_type: item.admin_type ?? null,
		geo: item.geo ?? null
	};
}

export function searchResultKey(result: FamilySearchResult, index: number): string {
	return `${result.shelter_name}:${result.name}:${result.national_id ?? index}`;
}
