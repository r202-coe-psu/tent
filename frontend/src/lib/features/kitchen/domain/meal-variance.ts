import type { MealPlan, MealService } from './kitchen';

/**
 * How the actual meal service compares to what the plan projected (T-27, FR).
 *   `on_target` — served within ±tolerance of planned
 *   `over`      — served MORE than planned (plan under-estimated demand)
 *   `under`     — served FEWER than planned (plan over-estimated; watch waste)
 *   `no_plan`   — no matching meal_plan, or planned headcount is 0 (nothing to compare)
 */
export type MealVarianceStatus = 'on_target' | 'over' | 'under' | 'no_plan';

export interface MealVariance {
	planned: number | null; // meal_plan.headcount.total; null when no matching plan
	served: number;
	waste: number;
	external: number; // volunteers + outside_evacuees
	produced: number; // served + waste — best estimate of what the kitchen cooked in-center
	variance: number; // served - planned (0 when no plan)
	variance_pct: number | null; // variance / planned * 100; null when planned is 0/absent
	status: MealVarianceStatus;
}

// Default ± band (percent of planned) inside which a service counts as on-target.
// A pure default so callers can tune it without the domain guessing operational policy.
export const VARIANCE_TOLERANCE_PCT = 5;

/**
 * Compares one meal_service record against the meal_plan for the same date+meal,
 * producing the plan-vs-actual variance the review screen shows (T-27). Pure — no
 * I/O; the caller joins the plan by matching deterministic ids.
 *
 * `variance` is served − planned so a positive number reads as "served more than
 * planned". `external` (volunteers + outside_evacuees) and `waste` are surfaced as
 * separate review signals, not folded into the served-vs-plan number.
 */
export function computeMealVariance(
	service: MealService,
	plan: MealPlan | null | undefined,
	tolerancePct: number = VARIANCE_TOLERANCE_PCT
): MealVariance {
	const served = service.served;
	const waste = service.waste;
	const external = service.external.volunteers + service.external.outside_evacuees;
	const produced = served + waste;

	const planned = plan ? plan.headcount.total : null;

	// No plan (or a 0-headcount plan) means there is nothing meaningful to divide by —
	// report the raw actuals but leave variance neutral so the row isn't flagged.
	if (planned === null || planned <= 0) {
		return {
			planned,
			served,
			waste,
			external,
			produced,
			variance: 0,
			variance_pct: null,
			status: 'no_plan'
		};
	}

	const variance = served - planned;
	const variancePct = (variance / planned) * 100;

	let status: MealVarianceStatus;
	if (Math.abs(variancePct) <= tolerancePct) {
		status = 'on_target';
	} else if (variance > 0) {
		status = 'over';
	} else {
		status = 'under';
	}

	return {
		planned,
		served,
		waste,
		external,
		produced,
		variance,
		variance_pct: variancePct,
		status
	};
}
