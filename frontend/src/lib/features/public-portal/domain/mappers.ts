import type { FamilySearchResult, PublicShelterCardModel, PublicShelterItem } from './types';

/** Normalize Mongo/API status for existing public UI color helpers. */
export function toUiShelterStatus(status: string | null | undefined): string {
	if (!status || typeof status !== 'string') return 'CLOSED';
	const s = status.trim().toLowerCase();
	if (s === 'open') return 'OPEN';
	if (s === 'full') return 'FULL';
	if (s === 'prepare' || s === 'preparing' || s === 'ready') return 'PREPARE';
	if (s === 'closed') return 'CLOSED';
	return status.toUpperCase();
}

export function isInShelterStatus(status: string | null | undefined): boolean {
	if (!status || typeof status !== 'string') return false;
	return status.trim().toLowerCase() === 'in_shelter';
}

export function toPublicShelterCard(
	item: Partial<PublicShelterItem> | null | undefined,
	distance = 0
): PublicShelterCardModel {
	const code = item?.code ?? '';
	const name = item?.name ?? (code || 'ศูนย์พักพิง');
	const subdistrict = item?.subdistrict ?? '';
	const district = item?.district ?? '';
	const province = item?.province ?? '';
	const parts = [subdistrict, district, province].filter(Boolean);
	const address = parts.length > 0 ? parts.join(' ') : code || name;

	return {
		id: code || ((item as Record<string, unknown>)?.id as string) || name,
		code,
		name,
		status: toUiShelterStatus(item?.status),
		address,
		distance: typeof distance === 'number' && !isNaN(distance) ? distance : 0,
		capacity: typeof item?.capacity === 'number' ? item.capacity : 0,
		province,
		district,
		subdistrict,
		pet_policy: item?.pet_policy ?? null,
		vulnerable_groups: Array.isArray(item?.vulnerable_groups) ? item.vulnerable_groups : null,
		admin_type: item?.admin_type ?? null,
		geo: item?.geo ?? null
	};
}

export function searchResultKey(result: FamilySearchResult, index: number): string {
	if (!result) return `result-${index}`;
	return `${result.shelter_name ?? 'shelter'}:${result.name ?? 'person'}:${result.national_id ?? index}`;
}
