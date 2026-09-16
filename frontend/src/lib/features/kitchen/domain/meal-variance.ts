import type { MealPlan, MealService } from './kitchen';

/** Variance status comparing served meals to planned headcount. */
export type MealVarianceStatus = 'on_target' | 'over' | 'under' | 'no_plan';

export interface MealVariance {
	planned: number | null; // meal_plan.headcount.total; null when no matching plan
	served: number;
	waste: number;
	external: number; // volunteers + outside_evacuees
	produced: number; // served + waste
	variance: number; // served - planned (0 when no plan)
	variance_pct: number | null; // variance / planned * 100; null when planned is 0/absent
	status: MealVarianceStatus;
	actual_yield: number | null; // Actual recorded kitchen yield
	yield_variance: number | null; // actual_yield - planned
}

// Default ± percentage band within which service is considered on-target.
export const VARIANCE_TOLERANCE_PCT = 5;

/** Thai display labels for meal variance status. */
export const MEAL_VARIANCE_STATUS_LABELS: Record<MealVarianceStatus, string> = {
	on_target: 'ตรงแผน',
	over: 'เกินแผน',
	under: 'ต่ำกว่าแผน',
	no_plan: 'ไม่มีแผนอ้างอิง'
};

/**
 * Compares meal service actuals against the meal plan to calculate variance metrics.
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
	const actualYield = service.actual_yield ?? null;

	const planned = plan ? plan.headcount.total : null;

	// Return neutral variance when plan is absent or headcount is zero.
	if (planned === null || planned <= 0) {
		return {
			planned,
			served,
			waste,
			external,
			produced,
			variance: 0,
			variance_pct: null,
			status: 'no_plan',
			actual_yield: actualYield,
			yield_variance: null
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

	const yieldVariance = actualYield !== null ? actualYield - planned : null;

	return {
		planned,
		served,
		waste,
		external,
		produced,
		variance,
		variance_pct: variancePct,
		status,
		actual_yield: actualYield,
		yield_variance: yieldVariance
	};
}
