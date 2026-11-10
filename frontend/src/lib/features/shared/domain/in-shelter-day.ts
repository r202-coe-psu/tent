/**
 * in-shelter-day.ts — was an evacuee in the shelter for the whole Thai calendar day?
 *
 * Pure — no I/O. `in-shelter.ts` answers "in the shelter now" from `current_stay`; this answers
 * it for a past day from the append-only `movement` history, so someone who checked out last
 * night is still counted for yesterday's meals. Mid-day arrivals, departures and temporary
 * leaves return false (they could not have eaten every meal here).
 *
 * `zone_change` does not change presence. When an evacuee has no movements at all (the initial
 * check-in movement is best-effort), fall back to `current_stay` when `since` predates the day.
 */
import { isInShelterStayStatus } from './in-shelter';

const THAILAND_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ENTERS = new Set(['check_in', 'transfer_in', 'return_from_leave', 'confirm_room']);
const LEAVES = new Set(['check_out', 'transfer_out', 'leave_temporary', 'mark_deceased']);

export interface PresenceMovement {
	action: string;
	occurred_at: string;
}

export interface PresenceInput {
	/** `YYYY-MM-DD`, Thai calendar day. */
	day: string;
	movements: readonly PresenceMovement[];
	current_stay?: { status?: string | null; since?: string | null } | null;
}

export function wasInShelterAllDay({ day, movements, current_stay }: PresenceInput): boolean {
	const dayStart = new Date(`${day}T00:00:00.000Z`).getTime() - THAILAND_UTC_OFFSET_MS;
	const dayEnd = dayStart + DAY_MS;

	if (movements.length === 0) {
		const since = current_stay?.since ? new Date(current_stay.since).getTime() : NaN;
		return isInShelterStayStatus(current_stay?.status) && since < dayStart;
	}

	const sorted = movements
		.map((m) => ({ action: m.action, at: new Date(m.occurred_at).getTime() }))
		.sort((a, b) => a.at - b.at);

	let inside = false;
	for (const m of sorted) {
		if (m.at >= dayEnd) break;
		if (m.at >= dayStart) {
			if (!inside || LEAVES.has(m.action)) return false;
			continue;
		}
		if (ENTERS.has(m.action)) inside = true;
		else if (LEAVES.has(m.action)) inside = false;
	}
	return inside;
}
