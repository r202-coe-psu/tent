import type { MealPlanHeadcount } from './kitchen';

/**
 * Derives a meal-plan {@link MealPlanHeadcount} from live occupancy (T-06).
 *
 * Pure and I/O-free: takes a minimal structural view of evacuees so the domain
 * layer never imports the `people` feature. The application layer maps real
 * `Evacuee` docs (which are structurally compatible) into this shape.
 *
 * Business rule (CR-022): only currently-present evacuees (`checked_in`) count.
 * Sub-counts are **orthogonal dimensions**, each derived independently — a
 * person may fall into more than one (e.g. a Muslim infant counts in both
 * `halal` and `infant`). Therefore each sub-count is ≤ `total`, but their sum
 * may exceed it. Never treat them as a partition.
 */
export interface OccupantView {
	current_stay: { status: string };
	religion?: string;
	special_needs?: readonly string[];
}

/** special_needs values that map to the soft-food diet (CR-022). */
export const SOFT_FOOD_NEEDS: readonly string[] = ['bedridden', 'chronic_illness', 'elderly'];

export function deriveHeadcountFromOccupancy(
	occupants: readonly OccupantView[]
): MealPlanHeadcount {
	const present = occupants.filter((o) => o.current_stay?.status === 'checked_in');
	const hasNeed = (o: OccupantView, needs: readonly string[]) =>
		(o.special_needs ?? []).some((n) => needs.includes(n));
	return {
		total: present.length,
		halal: present.filter((o) => o.religion === 'muslim').length,
		soft_food: present.filter((o) => hasNeed(o, SOFT_FOOD_NEEDS)).length,
		infant: present.filter((o) => hasNeed(o, ['infant'])).length
	};
}
