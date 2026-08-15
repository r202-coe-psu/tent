/**
 * Capacity guidance helpers — shelter max capacity vs sum of zone capacities.
 * Schema keeps both fields independent; UI surfaces mismatch + optional sync.
 */

export type ZoneCapacityLike = { capacity?: number | null };

export function sumZoneCapacities(zones: ZoneCapacityLike[] | null | undefined): number {
	if (!zones?.length) return 0;
	return zones.reduce((sum, z) => sum + (Number(z.capacity) || 0), 0);
}

export type CapacityAlignment = 'no_zones' | 'aligned' | 'zones_under' | 'zones_over';

export function capacityAlignment(
	shelterCapacity: number,
	zoneCapacitySum: number,
	zoneCount: number
): CapacityAlignment {
	if (zoneCount === 0) return 'no_zones';
	const shelter = Number(shelterCapacity) || 0;
	if (zoneCapacitySum === shelter) return 'aligned';
	if (zoneCapacitySum < shelter) return 'zones_under';
	return 'zones_over';
}

/** True when zones exist and their sum differs from shelter max capacity. */
export function canSyncCapacityFromZones(
	shelterCapacity: number,
	zoneCapacitySum: number,
	zoneCount: number
): boolean {
	return zoneCount > 0 && zoneCapacitySum > 0 && zoneCapacitySum !== (Number(shelterCapacity) || 0);
}
