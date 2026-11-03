/**
 * shelter-people.ts — the one count of "who is at this shelter right now" (#1068).
 *
 * Pure — no I/O. Evacuees come from {@link isInShelterStayStatus}; volunteers count only
 * while checked in here; staff are the shelter's active non-volunteer accounts. A staff
 * account linked to a volunteer profile (Staff-Capable Volunteer) counts as that volunteer
 * and never as staff, so nobody is counted twice.
 *
 * The kitchen settled these rules in #960 (issue #806); the Sphere stock tab reads the same
 * function rather than restating them, so a later ruling on how staff should be counted
 * changes one place.
 */

import { isInShelterStayStatus } from './in-shelter';

/** Minimal occupant fields needed to decide presence. */
export interface ShelterOccupantView {
	current_stay: { status: string };
}

/** Minimal volunteer fields needed to decide who is on site at a shelter. */
export interface VolunteerPresenceView {
	checked_in: boolean;
	current_shelter_code?: string | null;
	/** Linked staff account of a Staff-Capable Volunteer. */
	user_name?: string | null;
}

/** Minimal staff-user fields needed for the head count. */
export interface StaffUserView {
	name: string;
}

export interface ShelterPeopleCounts {
	evacuees: number;
	staff: number;
	volunteers: number;
}

export function countShelterPeople(
	shelterCode: string,
	occupants: readonly ShelterOccupantView[],
	volunteers: readonly VolunteerPresenceView[],
	staffUsers: readonly StaffUserView[]
): ShelterPeopleCounts {
	const linkedUserNames = new Set(volunteers.map((v) => v.user_name).filter(Boolean));
	const staffNames = new Set(
		staffUsers.map((u) => u.name).filter((name) => !linkedUserNames.has(name))
	);
	return {
		evacuees: occupants.filter((o) => isInShelterStayStatus(o.current_stay?.status)).length,
		staff: staffNames.size,
		volunteers: volunteers.filter((v) => v.checked_in && v.current_shelter_code === shelterCode)
			.length
	};
}

/** Everyone at the shelter: the base every daily requirement is sized from. */
export function totalShelterPeople(counts: ShelterPeopleCounts): number {
	return counts.evacuees + counts.staff + counts.volunteers;
}
