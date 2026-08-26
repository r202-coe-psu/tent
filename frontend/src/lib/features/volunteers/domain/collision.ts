/**
 * collision.ts — Time Collision Prevention (CR-092 FR-VOL-06.3 / CR-094 FR-VOL-09).
 *
 * A candidate duty window collides with an existing assignment when the two
 * `[start_ts, end_ts)` intervals overlap. Assignments that never happened
 * (`no_show`, `cancelled`) don't block a new dispatch.
 *
 * Fail-closed on garbage timestamps: `new Date(garbage).getTime()` is `NaN`,
 * and `NaN < x` / `x < NaN` are always `false` — left unguarded that makes an
 * unparseable window silently report "no overlap" and wave a double-booking
 * through. A window that cannot be verified is therefore treated as a
 * collision (deny), not as clear.
 */

import type { DutyWindow, ShiftAssignmentStatus } from './shift-assignment.schema';

/** Statuses that still hold the volunteer's time (block a new overlapping dispatch). */
const BLOCKING_STATUSES: ReadonlySet<ShiftAssignmentStatus> = new Set([
	'assigned',
	'standby',
	'checked_in',
	'completed'
]);

/**
 * Half-open interval overlap: `a.start < b.end && b.start < a.end`. Touching
 * edges don't collide. An unparseable `start_ts`/`end_ts` on either side
 * fails closed — treated as an overlap, never silently `false`.
 */
export function windowsOverlap(a: DutyWindow, b: DutyWindow): boolean {
	const aStart = new Date(a.start_ts).getTime();
	const aEnd = new Date(a.end_ts).getTime();
	const bStart = new Date(b.start_ts).getTime();
	const bEnd = new Date(b.end_ts).getTime();
	if ([aStart, aEnd, bStart, bEnd].some((ts) => Number.isNaN(ts))) return true;
	return aStart < bEnd && bStart < aEnd;
}

export interface CollisionCandidate {
	duty_window: DutyWindow;
	status: ShiftAssignmentStatus;
}

/**
 * True when `candidateWindow` overlaps any of `existingAssignments` that are
 * still holding the volunteer's time. Empty input never collides.
 */
export function hasTimeCollision(
	candidateWindow: DutyWindow,
	existingAssignments: readonly CollisionCandidate[]
): boolean {
	return existingAssignments.some(
		(a) => BLOCKING_STATUSES.has(a.status) && windowsOverlap(candidateWindow, a.duty_window)
	);
}
