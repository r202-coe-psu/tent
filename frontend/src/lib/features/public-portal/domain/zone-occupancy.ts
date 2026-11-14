/**
 * Per-zone fill for the public shelter detail (draft-public-zone-occupancy, #1241).
 * Same thresholds as the back-office zone card (CR-226 FR-12) so both sides agree.
 */

export type PublicZoneOccupancyLevel = 'normal' | 'warning' | 'full';

export type PublicZoneOccupancy = {
	present: number;
	/** `null` when the zone has no capacity on record — fill is unknown, so no bar or level. */
	capacity: number | null;
	/** `round(present / capacity × 100)`, not clamped — 12 of 10 is 120. */
	percent: number | null;
	level: PublicZoneOccupancyLevel | null;
};

export type PublicZoneCounts = {
	present?: number | null;
	capacity?: number | null;
};

/** `null` when the API has no per-zone count yet (`present: null`) — show no headcount then. */
export function publicZoneOccupancy(zone: PublicZoneCounts): PublicZoneOccupancy | null {
	if (zone.present === null || zone.present === undefined) return null;
	const present = zone.present;
	const capacity = zone.capacity ?? null;
	// Unknown capacity: whether the zone is free or full cannot be told (FR-13).
	if (capacity === null) return { present, capacity, percent: null, level: null };
	if (capacity <= 0) return { present, capacity, percent: 0, level: 'full' };
	const percent = Math.round((present / capacity) * 100);
	const level = present >= capacity ? 'full' : present >= capacity * 0.8 ? 'warning' : 'normal';
	return { present, capacity, percent, level };
}
