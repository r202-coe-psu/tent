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

/**
 * `id` is the shelter `code`, falling back to the display name for the
 * defensive null/`{}` cases the tests cover. It used to try `(item as any).id`
 * in between — `ShelterItem` has no `id` in the contract, so that branch could
 * never fire and only existed to defeat the type checker.
 */
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

	const rawId = (item as Record<string, unknown> | null | undefined)?.id;
	const itemId = typeof rawId === 'string' ? rawId : '';

	return {
		id: code || itemId || name,
		code,
		name,
		site_kind: item?.site_kind === 'host_house' ? 'host_house' : 'evacuation_center',
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

/**
 * `{#each}` key for a public search result.
 *
 * A result carries no id — the projection masks the surname and the national ID
 * and exposes neither the evacuee doc id nor the hash (public search must not
 * become a person-identity oracle). So the visible fields are NOT unique: the
 * same human registered twice at one shelter produces two rows that agree on
 * every field the API returns, and keying on those alone crashes the list with
 * `each_key_duplicate`. Position is therefore part of the key, appended to the
 * identity rather than replacing it, so the key still tracks a row across a
 * re-render of the same result set.
 *
 * `index` must be the result's index in the FULL result list, not within a page
 * — otherwise two rows on different pages of one list collide again.
 */
export function searchResultKey(result: FamilySearchResult, index: number): string {
	if (!result) return `result-${index}`;
	const identity = `${result.shelter_name ?? 'shelter'}:${result.name ?? 'person'}:${result.national_id ?? 'no-id'}`;
	return `${identity}:${index}`;
}
