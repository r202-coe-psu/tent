/**
 * domain/zone-occupancy.schema.ts — dashboard per-zone occupancy (CR-226)
 *
 * CouchDB view: `_design/app/_view/occupancy_by_zone?group=true`, key `[zone, status]`, `_count`.
 * The BFF flattens rows to `{ zone, status, count }`; `toZoneOccupancies` joins them with the
 * shelter's `zones[]`. Only aggregate counts leave the server — no PII.
 */
import { z } from 'zod';

export const ZoneStatusCountSchema = z.object({
	zone: z.string(),
	status: z.string(),
	count: z.number().int().nonnegative()
});
export type ZoneStatusCount = z.infer<typeof ZoneStatusCountSchema>;

export const ZoneOccupancyPayloadSchema = z.object({
	shelter_code: z.string(),
	rows: z.array(ZoneStatusCountSchema)
});
export type ZoneOccupancyPayload = z.infer<typeof ZoneOccupancyPayloadSchema>;

/** Present = still holds a place in the zone, same as the onsite zoning page (CR-226 FR-1). */
const PRESENT_STATUSES: ReadonlySet<string> = new Set([
	'active',
	'room_confirmed',
	'temporary_leave'
]);

/** The fields of a shelter zone this widget needs. */
export type ZoneCapacityInput = {
	code: string;
	name: string;
	capacity: number;
	status: 'active' | 'closed';
};

export type ZoneOccupancyLevel = 'normal' | 'warning' | 'full';

export type ZoneOccupancy = {
	code: string;
	name: string;
	count: number;
	capacity: number;
	/** `round(count / capacity × 100)`, not clamped (FR-12a). */
	percent: number;
	level: ZoneOccupancyLevel;
	closed: boolean;
};

function occupancyLevel(count: number, capacity: number): ZoneOccupancyLevel {
	if (capacity <= 0 || count >= capacity) return 'full';
	return count >= capacity * 0.8 ? 'warning' : 'normal';
}

export function toZoneOccupancies(
	rows: readonly ZoneStatusCount[],
	zones: readonly ZoneCapacityInput[]
): ZoneOccupancy[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (!PRESENT_STATUSES.has(row.status)) continue;
		counts.set(row.zone, (counts.get(row.zone) ?? 0) + row.count);
	}
	return zones.map((zone) => {
		const count = counts.get(zone.code) ?? 0;
		const { capacity } = zone;
		const percent = capacity > 0 ? Math.round((count / capacity) * 100) : 0;
		const level = occupancyLevel(count, capacity);
		return {
			code: zone.code,
			name: zone.name,
			count,
			capacity,
			percent,
			level,
			closed: zone.status === 'closed'
		};
	});
}

export type ZoneOccupancySummary = {
	/** Open zones only, so present, capacity and available share one base. */
	present: number;
	capacity: number;
	available: number;
	percent: number;
	/** `null` when no zone is open: there is no capacity to rate, so the UI shows an empty state. */
	level: ZoneOccupancyLevel | null;
	zones: Record<ZoneOccupancyLevel | 'closed', number>;
};

export function summarizeZoneOccupancy(zones: readonly ZoneOccupancy[]): ZoneOccupancySummary {
	const tally = { normal: 0, warning: 0, full: 0, closed: 0 };
	let present = 0;
	let capacity = 0;
	for (const zone of zones) {
		if (zone.closed) {
			tally.closed += 1;
			continue;
		}
		present += zone.count;
		capacity += zone.capacity;
		tally[zone.level] += 1;
	}
	return {
		present,
		capacity,
		available: Math.max(0, capacity - present),
		percent: capacity > 0 ? Math.round((present / capacity) * 100) : 0,
		level: tally.normal + tally.warning + tally.full > 0 ? occupancyLevel(present, capacity) : null,
		zones: tally
	};
}
