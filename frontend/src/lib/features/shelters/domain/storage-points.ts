import type { SubStorageItem, SubStorageType } from './schema';

/** Thai labels for `common_areas.sub_storage[].type` — shared by the shelter form and stock UIs. */
export const SUB_STORAGE_TYPE_LABELS: Record<SubStorageType, string> = {
	general: 'ทั่วไป',
	food_dry: 'อาหารแห้ง',
	drinking_water: 'น้ำดื่ม',
	medical_supplies: 'เวชภัณฑ์'
};

type ShelterWithStorage = {
	common_areas?: { sub_storage?: readonly SubStorageItem[] | null } | null;
} | null;

/**
 * A shelter's storage points ("จุดเก็บของ") in form order — the options the stock
 * UIs offer for "สถานที่จัดเก็บ" (draft-shelter-storage-points). Rows without an
 * `id` or name cannot be referenced from a ledger lot, so they are left out.
 */
export function listStoragePoints(shelter: ShelterWithStorage | undefined): SubStorageItem[] {
	return (shelter?.common_areas?.sub_storage ?? []).filter(
		(point) => !!point.id && point.name.trim() !== ''
	);
}
