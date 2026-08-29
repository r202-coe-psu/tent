/**
 * duty-window.ts — Time-Bound Write Access window math (CR-094 FR-VOL-05R.3).
 *
 * Enforcement itself lives at CouchDB (`validate_doc_update` + role grant/revoke,
 * per CR-094 D-VOL-ENFORCE) — this module only computes the pure predicate the
 * grant/revoke route and any UI countdown reuse:
 *   grant window = duty_window.start_ts − 5m … duty_window.end_ts + 5m
 *
 * Shift templates (`SHIFT_WINDOWS`) are defined in **Asia/Bangkok wall-clock**
 * hours (UTC+7, fixed — Thailand observes no DST) per CR-094 §3.2 /
 * schema.md §2.9: morning 08:00–16:00, afternoon 16:00–00:00(+1d), night
 * 00:00–08:00, all *local*. `resolveDutyWindow` converts that local
 * wall-clock moment to the UTC instant that is actually persisted in
 * `duty_window` — e.g. `night`'s local 00:00 is `17:00Z` on the **previous**
 * calendar day.
 *
 * `flex` shifts carry no fixed window (CR-094 §3.2) — `resolveDutyWindow`
 * returns `null` for them (and for `custom`, which is caller-supplied). A
 * `null` window can never be verified as "on duty", so
 * `isWithinDutyWindow(now, null)` is always `false` (deny) — an authorization
 * primitive must fail closed, not open (CR-094 FR-VOL-05R.4).
 */

import { SHIFT_WINDOWS, type DutyWindow, type ShiftKind } from './shift-assignment.schema';

/** CR-094 FR-VOL-05R.3 — grace period on both edges of the duty window. */
export const DEFAULT_GRACE_MINUTES = 5;

/** Fixed UTC offset for Asia/Bangkok — no DST, so this never changes. */
const BANGKOK_UTC_OFFSET_HOURS = 7;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export class DutyWindowError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DutyWindowError';
	}
}

/**
 * Convert a Bangkok (+07:00) local wall-clock moment — calendar `date` plus
 * `hour` (0–24; 24 means "next calendar day at 00:00", so callers never need
 * to bump `date` themselves for a shift that starts/ends exactly at local
 * midnight) — into the equivalent UTC instant.
 */
function bangkokWallClockToUtc(date: string, hour: number): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new DutyWindowError(`Invalid date (expected YYYY-MM-DD): ${date}`);
	}
	const anchor = new Date(`${date}T00:00:00.000Z`);
	if (Number.isNaN(anchor.getTime())) {
		throw new DutyWindowError(`Invalid date: ${date}`);
	}
	// `new Date('2026-02-29T…')` silently normalises to 2026-03-01 rather than
	// failing, so a non-existent calendar date has to be caught by round-trip.
	if (anchor.toISOString().slice(0, 10) !== date) {
		throw new DutyWindowError(`Non-existent calendar date: ${date}`);
	}
	return new Date(anchor.getTime() + (hour - BANGKOK_UTC_OFFSET_HOURS) * MS_PER_HOUR);
}

/**
 * The Asia/Bangkok calendar date (`YYYY-MM-DD`) that `now` falls on.
 *
 * "Today" for the roster, the attendance bar and the Control Hub counters is
 * the date a person standing in the shelter would name — not the UTC date.
 * Between 00:00 and 07:00 Bangkok the two disagree, which is exactly when the
 * `night` shift (00:00–08:00 local) is running, so a UTC-derived "today"
 * queries yesterday's roster for that shift's entire duration.
 */
export function bangkokDateString(now: string | Date = new Date()): string {
	const nowMs = new Date(now).getTime();
	if (Number.isNaN(nowMs)) {
		throw new DutyWindowError(`Invalid instant: ${String(now)}`);
	}
	return new Date(nowMs + BANGKOK_UTC_OFFSET_HOURS * MS_PER_HOUR).toISOString().slice(0, 10);
}

/**
 * Standard duty window for a templated shift on a given date, expressed as
 * the UTC instants equivalent to the Bangkok local wall-clock template in
 * `SHIFT_WINDOWS`. Returns `null` for `flex`/`custom`, which have no standard
 * template — callers must supply `duty_window` explicitly for those.
 *
 * Throws `DutyWindowError` for a malformed `date` (never a raw `RangeError`).
 */
export function resolveDutyWindow(date: string, shift: ShiftKind): DutyWindow | null {
	if (shift !== 'morning' && shift !== 'afternoon' && shift !== 'night') return null;
	const template = SHIFT_WINDOWS[shift];
	const start = bangkokWallClockToUtc(date, template.startHour);
	const end = new Date(start.getTime() + template.durationHours * MS_PER_HOUR);
	return { start_ts: start.toISOString(), end_ts: end.toISOString() };
}

/** `HH:mm` (24h) → hours-since-midnight, fractional. Rejects `25:00` / `08:60`. */
function parseWallClockTime(time: string): number {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
	if (!match) {
		throw new DutyWindowError(`Invalid time (expected HH:mm, 00:00-23:59): ${time}`);
	}
	return Number(match[1]) + Number(match[2]) / 60;
}

/**
 * Duty window for an explicit Bangkok wall-clock span — one `job.shifts[]` row
 * (schema_v 3), which carries its own `end_date`, so a shift crossing midnight
 * needs no special case here.
 *
 * This is the counterpart of {@link resolveDutyWindow} for shifts that are NOT
 * one of the three 8h templates: the job form lets an SM pick any start/end,
 * and dispatching from such a shift still has to store the same UTC
 * `duty_window` shape that `collision.ts` compares. Keeping the conversion
 * here means no screen (and no seed script) does Bangkok→UTC arithmetic of its
 * own.
 *
 * Throws `DutyWindowError` on a malformed date/time or a non-positive span,
 * so an unusable window can never reach `shiftAssignmentSchema` (where it
 * would only be caught as a generic parse failure).
 */
export function shiftDutyWindow(shift: {
	date: string;
	end_date: string;
	start_time: string;
	end_time: string;
}): DutyWindow {
	const start = bangkokWallClockToUtc(shift.date, parseWallClockTime(shift.start_time));
	const end = bangkokWallClockToUtc(shift.end_date, parseWallClockTime(shift.end_time));
	if (start.getTime() >= end.getTime()) {
		throw new DutyWindowError(
			`Shift ends before it starts: ${shift.date} ${shift.start_time} → ${shift.end_date} ${shift.end_time}`
		);
	}
	return { start_ts: start.toISOString(), end_ts: end.toISOString() };
}

/**
 * True when `now` falls within `[window.start_ts - grace, window.end_ts + grace]`
 * (inclusive both ends — CR-094 FR-VOL-05R.3/CR-092 FR-VOL-05 use `>=`/`<=`).
 * `window === null` (the `flex`/no-fixed-window case) means the predicate
 * cannot be verified — DENY, not allow (CR-094 FR-VOL-05R.4 fail-closed).
 */
export function isWithinDutyWindow(
	now: string | Date,
	window: DutyWindow | null,
	graceMinutes: number = DEFAULT_GRACE_MINUTES
): boolean {
	if (window === null) return false;
	const nowMs = new Date(now).getTime();
	const graceMs = graceMinutes * MS_PER_MINUTE;
	const startMs = new Date(window.start_ts).getTime() - graceMs;
	const endMs = new Date(window.end_ts).getTime() + graceMs;
	return nowMs >= startMs && nowMs <= endMs;
}
