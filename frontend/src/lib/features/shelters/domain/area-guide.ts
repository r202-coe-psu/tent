/**
 * Area guidance helpers — shelter total usable area vs sum of zone areas (and common areas).
 * Schema keeps both fields independent; UI surfaces mismatch + optional sync.
 */

export type ZoneAreaLike = { area_m2?: number | null };

export type CommonAreasLike =
	| {
			sub_storage?: { area_m2?: number | null }[] | null;
			logistics_area_m2?: number | null;
	  }
	| null
	| undefined;

/** Sums area_m2 across zones, rounded to 2 decimal places to avoid floating point inaccuracies. */
export function sumZoneAreas(zones: ZoneAreaLike[] | null | undefined): number {
	if (!zones?.length) return 0;
	const sum = zones.reduce((acc, z) => acc + (Number(z.area_m2) || 0), 0);
	return Math.round(sum * 100) / 100;
}

/** Sums common area spaces (sub-storage + logistics area), rounded to 2 decimal places. */
export function sumCommonAreas(commonAreas: CommonAreasLike): number {
	if (!commonAreas) return 0;
	const storageSum = (commonAreas.sub_storage ?? []).reduce(
		(acc, s) => acc + (Number(s.area_m2) || 0),
		0
	);
	const logistics = Number(commonAreas.logistics_area_m2) || 0;
	return Math.round((storageSum + logistics) * 100) / 100;
}

export type AreaAlignment = 'no_zones' | 'aligned' | 'zones_under' | 'zones_over';

export function areaAlignment(
	shelterArea: number | null | undefined,
	zoneAreaSum: number,
	zoneCount: number
): AreaAlignment {
	if (zoneCount === 0 || zoneAreaSum === 0) return 'no_zones';
	const shelter = Number(shelterArea) || 0;
	if (Math.abs(zoneAreaSum - shelter) < 0.001) return 'aligned';
	if (zoneAreaSum < shelter) return 'zones_under';
	return 'zones_over';
}

/** True when zones exist with area > 0 and their sum differs from shelter total area. */
export function canSyncAreaFromZones(
	shelterArea: number | null | undefined,
	zoneAreaSum: number,
	zoneCount: number
): boolean {
	const shelter = Number(shelterArea) || 0;
	return zoneCount > 0 && zoneAreaSum > 0 && Math.abs(zoneAreaSum - shelter) >= 0.001;
}
