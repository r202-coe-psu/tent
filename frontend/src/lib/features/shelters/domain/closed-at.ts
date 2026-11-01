/**
 * Retention clock for a closed shelter (CR-183 FR-14/FR-15).
 *
 * Returns the `closed_at` the registry doc must hold after a save. A closed
 * shelter keeps its existing stamp so later edits do not restart the clock;
 * leaving `closed` clears it so a re-close counts from zero. Only the
 * transition into `closed` stamps: a legacy closed shelter without a stamp gets
 * its real close time from the FR-22 backfill, not the time of an unrelated edit.
 *
 * @param nextStatus status in the incoming patch; `undefined` or `null` means
 *   the patch does not touch `operation_status`.
 */
export function nextClosedAt(
	prevStatus: string | null,
	nextStatus: string | null | undefined,
	prevClosedAt: string | null | undefined,
	now: string
): string | null {
	const effective = nextStatus ?? prevStatus;
	if (effective === 'closed') return prevClosedAt || (prevStatus === 'closed' ? null : now);
	if (effective === null) return prevClosedAt || null;
	return null;
}
