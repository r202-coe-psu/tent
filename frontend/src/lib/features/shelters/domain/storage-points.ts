import { subStorageTypeSchema, type SubStorageItem, type SubStorageType } from './schema';

/**
 * Thai labels for `common_areas.sub_storage[].types[]` — shared by the shelter
 * form and stock UIs. Key order is display order (CR-199).
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

/**
 * `types` in enum order (the order of the #647 table), de-duplicated — what the
 * form writes and the UIs show, whatever order the user clicked in.
 */
export function sortSubStorageTypes(types: readonly SubStorageType[]): SubStorageType[] {
	return subStorageTypeSchema.options.filter((t) => types.includes(t));
}

/** Thai labels of `types`, in enum order. */
export function subStorageTypeLabels(types: readonly SubStorageType[]): string[] {
	return sortSubStorageTypes(types).map((t) => SUB_STORAGE_TYPE_LABELS[t]);
}

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

/**
 * Storage points ticked as donation drop-off points (CR-205). A ticked point with no
 * usable pin is left out, matching what the worker projects to the public plane.
 */
export function listDonationPoints(shelter: ShelterWithStorage | undefined): SubStorageItem[] {
	return listStoragePoints(shelter).filter(
		(point) =>
			point.accepts_donations === true &&
			point.lat != null &&
			point.lng != null &&
			!(point.lat === 0 && point.lng === 0)
	);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	return (
		ka.length === kb.length &&
		ka.every((k) => k in b && deepEqual((a as never)[k], (b as never)[k]))
	);
}

/**
 * `common_areas` for the shelter PATCH: drops `sub_storage` when it still equals what the form
 * loaded, so saving the form cannot overwrite points added elsewhere (CR-230).
 */
export function omitUnchangedSubStorage<T extends { sub_storage?: SubStorageItem[] }>(
	commonAreas: T,
	baseline: readonly SubStorageItem[] | undefined
): Omit<T, 'sub_storage'> | T {
	if (!deepEqual(commonAreas.sub_storage ?? [], baseline ?? [])) return commonAreas;
	const rest: Partial<T> = { ...commonAreas };
	delete rest.sub_storage;
	return rest as Omit<T, 'sub_storage'>;
}

/** True when two point lists are the same (missing and empty count as equal). */
export function sameSubStorage(
	a: readonly SubStorageItem[] | undefined,
	b: readonly SubStorageItem[] | undefined
): boolean {
	return deepEqual(a ?? [], b ?? []);
}
