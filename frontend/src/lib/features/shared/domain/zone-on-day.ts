/**
 * zone-on-day.ts — which zone was an evacuee in at the end of a Thai calendar day?
 *
 * Pure — no I/O. `current_stay.zone` is only the zone now, so a report for a past day reads the
 * append-only `movement` history instead and a later move does not rewrite that day.
 */
import { thaiDayRangeMs } from './in-shelter-day';

export interface ZoneMovement {
	occurred_at: string;
	zone?: string | null;
}

export interface ZoneOnDayInput {
	/** `YYYY-MM-DD`, Thai calendar day. */
	day: string;
	movements: readonly ZoneMovement[];
	/** `current_stay.zone`, used when no movement before the end of `day` names a zone. */
	currentZone?: string | null;
}

export function zoneOnDay({ day, movements, currentZone }: ZoneOnDayInput): string | null {
	const { end } = thaiDayRangeMs(day);
	let latest: { at: number; zone: string } | null = null;
	for (const m of movements) {
		const at = new Date(m.occurred_at).getTime();
		if (!m.zone || !(at < end) || (latest && at < latest.at)) continue;
		latest = { at, zone: m.zone };
	}
	return latest?.zone ?? currentZone ?? null;
}
