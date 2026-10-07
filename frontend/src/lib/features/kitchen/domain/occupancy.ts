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
 * Derives meal plan headcount metrics from active occupants.
 * Sub-counts (halal, soft_food, infant) are orthogonal dimensions.
 */
export function deriveHeadcountFromOccupancy(
	occupants: readonly OccupantView[]
): MealPlanHeadcount {
	const present = occupants.filter((o) => o.current_stay?.status === 'active');
	const hasNeed = (o: OccupantView, needs: readonly string[]) =>
		(o.special_needs ?? []).some((n) => needs.includes(n));
	return {
		total: present.length,
		halal: present.filter((o) => o.religion === 'muslim').length,
		soft_food: present.filter((o) => hasNeed(o, SOFT_FOOD_NEEDS)).length,
		infant: present.filter((o) => hasNeed(o, ['infant'])).length
	};
}

/** Derives meal session 5-group headcount from active occupants. */
export function deriveSessionHeadcountFromOccupancy(
	occupants: readonly OccupantView[]
): MealSessionHeadcount {
	const present = occupants.filter((o) => o.current_stay?.status === 'active');
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
		volunteer: 0,
		total: present.length
	};
}
