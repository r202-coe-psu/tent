import type { SubStorageItem, SubStorageType } from './schema';

/**
 * Thai labels for `common_areas.sub_storage[].types[]` — shared by the shelter
 * form and stock UIs. Key order is display order (CR-175).
 */
export const SUB_STORAGE_TYPE_LABELS: Record<SubStorageType, string> = {
	general: 'ทั่วไป',
	baby_food: 'อาหารเด็ก',
	food_dry: 'อาหารแห้ง',
	cooked_food: 'อาหารปรุงสุก',
	food_cold: 'อาหารแช่เย็น/แข็ง',
	medical_supplies: 'ยา',
	drinking_water: 'น้ำดื่ม'
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
