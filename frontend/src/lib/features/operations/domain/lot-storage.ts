import type { StockLot } from './operations';

/**
 * Where a lot sits ("สถานที่จัดเก็บ") — draft-shelter-storage-points.
 *
 * Since stock_ledger schema_v 5 a location is `lot.storage_point_id` (→ the
 * shelter's `common_areas.sub_storage[].id`) plus `lot.storage_zone` (the point's
 * name at write time). Older rows put free text in `storage_zone` (CR-088) or,
 * from the pre-schema_v 5 stock forms, in `lot.note` — which ALSO carries menu
 * names and the system values below, so those must never read as a location.
 */

/** Shown for a lot with no recorded location. */
export const DEFAULT_STORAGE_LABEL = 'คลังหลัก';

/** `lot.note` values written by workflows, not by a person naming a place (CR-121, CR-134). */
const LOT_NOTE_SYSTEM_VALUES: ReadonlySet<string> = new Set([
	'counter_loan_return',
	'bulk_return_pool',
	'distribution_return'
]);

/** The minimum of a shelter storage point the stock UIs need. */
export interface StoragePointRef {
	id: string;
	name: string;
}

type LotLike = StockLot | null | undefined;

/**
 * The lot's location name, or `null` when none was recorded. Order: current name
 * of `storage_point_id` → `storage_zone` snapshot → legacy `note` → none. A renamed
 * point therefore shows its new name; a deleted one falls back to the snapshot.
 */
export function lotStorageName(
	lot: LotLike,
	points: readonly StoragePointRef[] = []
): string | null {
	if (!lot) return null;
	if (lot.storage_point_id) {
		const current = points.find((p) => p.id === lot.storage_point_id)?.name.trim();
		if (current) return current;
	}
	const zone = lot.storage_zone?.trim();
	if (zone) return zone;
	const note = lot.note?.trim();
	if (note && !LOT_NOTE_SYSTEM_VALUES.has(note)) return note;
	return null;
}

/** {@link lotStorageName} with the "คลังหลัก" fallback, for display. */
export function lotStorageLabel(lot: LotLike, points: readonly StoragePointRef[] = []): string {
	return lotStorageName(lot, points) ?? DEFAULT_STORAGE_LABEL;
}

/**
 * Grouping key for "same location": the point id when there is one (survives a
 * rename), otherwise the resolved name. Unspecified lots share the empty key.
 */
export function lotStorageKey(lot: LotLike): string {
	if (lot?.storage_point_id) return `id:${lot.storage_point_id}`;
	const name = lotStorageName(lot);
	return name ? `name:${name}` : '';
}

/**
 * The `lot` location fields to write for a chosen point (`null` = unspecified).
 * Writers never put a location in `lot.note` any more.
 */
export function storageLotFields(
	point: StoragePointRef | null
): Pick<StockLot, 'storage_zone' | 'storage_point_id'> {
	if (!point) return {};
	return { storage_point_id: point.id, storage_zone: point.name.trim() };
}

/**
 * The location fields exactly as a lot's rows carry them, so an adjustment
 * written with them lands in the same {@link lotStorageKey} group. A legacy
 * location stays in `note` (where the group's other rows have it).
 */
export function lotLocationFields(
	lot: LotLike
): Pick<StockLot, 'note' | 'storage_zone' | 'storage_point_id'> {
	if (lot?.storage_point_id) {
		return {
			storage_point_id: lot.storage_point_id,
			...(lot.storage_zone?.trim() ? { storage_zone: lot.storage_zone.trim() } : {})
		};
	}
	const zone = lot?.storage_zone?.trim();
	if (zone) return { storage_zone: zone };
	const legacy = lotStorageName(lot);
	return legacy ? { note: legacy } : {};
}
