import { isInShelterStayStatus } from '$lib/features/shared';
import type { MealPlanHeadcount, MealSessionHeadcount } from './kitchen';

/** Minimal representation of an occupant required for kitchen headcount calculations. */
export interface OccupantView {
	current_stay: { status: string };
	religion?: string;
	special_needs?: readonly string[];
}

/** Special needs categories that qualify for soft-food diet. */
export const SOFT_FOOD_NEEDS: readonly string[] = ['bedridden', 'chronic_illness', 'elderly'];

/**
 * Derives meal plan headcount metrics from occupants in the shelter (`active` +
 * `room_confirmed` — draft-in-shelter-headcount, which supersedes CR-022's `checked_in`).
 * Sub-counts (halal, soft_food, infant) are orthogonal dimensions.
 */
export function deriveHeadcountFromOccupancy(
	occupants: readonly OccupantView[]
): MealPlanHeadcount {
	const present = occupants.filter((o) => isInShelterStayStatus(o.current_stay?.status));
	const hasNeed = (o: OccupantView, needs: readonly string[]) =>
		(o.special_needs ?? []).some((n) => needs.includes(n));
	return {
		total: present.length,
		halal: present.filter((o) => o.religion === 'muslim').length,
		soft_food: present.filter((o) => hasNeed(o, SOFT_FOOD_NEEDS)).length,
		infant: present.filter((o) => hasNeed(o, ['infant'])).length
	};
}

/** Minimal volunteer fields required to decide who is on site at a shelter. */
export interface VolunteerPresenceView {
	checked_in: boolean;
	current_shelter_code?: string | null;
	/** Linked staff account of a Staff-Capable Volunteer. */
	user_name?: string | null;
}

/** Minimal staff-user fields required for kitchen headcount calculations. */
export interface StaffUserView {
	name: string;
}

export interface ShelterPeopleCounts {
	evacuees: number;
	staff: number;
	volunteers: number;
}

/**
 * Counts the people the kitchen cooks for at one shelter. Volunteers count only while checked in
 * here. A staff user linked to a volunteer profile counts only as that volunteer, never as staff,
 * so a Staff-Capable Volunteer is not counted twice.
 */
export function countShelterPeople(
	shelterCode: string,
	occupants: readonly OccupantView[],
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

/**
 * Derives meal session 5-group headcount from occupants in the shelter. `staffAndVolunteers`
 * fills the `volunteer` group and is part of `total`, which is the sum of the five groups.
 */
export function deriveSessionHeadcountFromOccupancy(
	occupants: readonly OccupantView[],
	staffAndVolunteers = 0
): MealSessionHeadcount {
	const present = occupants.filter((o) => isInShelterStayStatus(o.current_stay?.status));
	const hasNeed = (o: OccupantView, needs: readonly string[]) =>
		(o.special_needs ?? []).some((n) => needs.includes(n));
	const halal = present.filter((o) => o.religion === 'muslim').length;
	const infant = present.filter((o) => hasNeed(o, ['infant'])).length;
	const softFood = present.filter((o) => hasNeed(o, SOFT_FOOD_NEEDS)).length;
	const regular = present.filter(
		(o) => o.religion !== 'muslim' && !hasNeed(o, ['infant']) && !hasNeed(o, SOFT_FOOD_NEEDS)
	).length;
	return {
		halal,
		infant,
		soft_food: softFood,
		regular,
		volunteer: staffAndVolunteers,
		total: present.length + staffAndVolunteers
	};
}
