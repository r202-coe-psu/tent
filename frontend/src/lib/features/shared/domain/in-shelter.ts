/**
 * in-shelter.ts — the one definition of "in the shelter" for headcounts
 * (draft-in-shelter-headcount, issue #593).
 *
 * Pure — no I/O. An evacuee is in the shelter when their `current_stay.status` is
 * `active` (checked in) or `room_confirmed` (arrival at their zone confirmed — CR-112):
 * both are physically here, sleep here and eat here. Every headcount that sizes a
 * shelter's capacity, stock, meals or SOP needs counts exactly these — the evacuee
 * dashboard's `in_shelter` (CR-170), the shelter list, supply, the Sphere food tab, the
 * kitchen meal plan and `daily_calc.occupancy_snapshot`. The worker mirrors it as
 * `IN_SHELTER_STATUSES` for partner EXT-005 `occupancy_total` and the EXT-007 occupant list
 * (decision sync 2026-11-02) — change both together.
 *
 * Not this definition, on purpose: CR-112's Forecast / Present / In-zone metrics.
 *
 * Deliberately not included: `arriving` / `pre_registered` / `kiosk_registered` (still in
 * intake), `temporary_leave` (away — CR-112 "Present" counts it for system overview only),
 * and every departed status.
 */

export const IN_SHELTER_STATUSES = ['active', 'room_confirmed'] as const;

export type InShelterStatus = (typeof IN_SHELTER_STATUSES)[number];

/** True when a `current_stay.status` means the evacuee is in the shelter. */
export function isInShelterStayStatus(
	status: string | null | undefined
): status is InShelterStatus {
	return (IN_SHELTER_STATUSES as readonly string[]).includes(status ?? '');
}

/** How many of these evacuees are in the shelter. */
export function countInShelter(
	evacuees: readonly { current_stay?: { status?: string | null } | null }[]
): number {
	return evacuees.filter((evacuee) => isInShelterStayStatus(evacuee.current_stay?.status)).length;
}

/** In-shelter total from per-status counts (e.g. a `status` view grouped by key). */
export function inShelterFromStatusCounts(counts: Readonly<Record<string, number>>): number {
	return IN_SHELTER_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}
