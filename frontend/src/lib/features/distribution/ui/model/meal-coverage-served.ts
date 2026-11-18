import { mealServiceReceiptOutcome } from '$lib/features/kitchen';
import type { MealPeriod } from '../../domain/food-supplies';
import { COVERAGE_MEALS } from '../../domain/food-supplies/meal-coverage';

interface ServedService {
	_id: string;
	date: string;
	meal: MealPeriod;
	/** Portions the kitchen produced; the plate count `served` stands in when it is not recorded. */
	actual_yield?: number | null;
	served?: number | null;
}

interface ServedReceipt {
	meal_service_id: string;
	outcome?: 'confirmed' | 'rejected';
	created_at: string;
}

/**
 * The `meal_service` docs of `day` that count: its warehouse receipt did not reject them. A
 * `meal_service` with no receipt yet counts.
 */
function acceptedServicesOfDay<S extends ServedService>(
	day: string,
	services: readonly S[],
	receipts: readonly ServedReceipt[]
): S[] {
	// Receipts are append-only, so a re-decision adds one: the latest wins.
	const latest = new Map<string, ServedReceipt>();
	for (const r of receipts) {
		const seen = latest.get(r.meal_service_id);
		if (!seen || r.created_at >= seen.created_at) latest.set(r.meal_service_id, r);
	}
	return services.filter((s) => {
		if (s.date !== day) return false;
		const receipt = latest.get(s._id);
		return !(receipt && mealServiceReceiptOutcome(receipt) === 'rejected');
	});
}

/** Coverage meals already served on `day`: at least one accepted `meal_service` of that meal. */
export function servedMealsOfDay(
	day: string,
	services: readonly ServedService[],
	receipts: readonly ServedReceipt[]
): MealPeriod[] {
	const served = new Set(acceptedServicesOfDay(day, services, receipts).map((s) => s.meal));
	return COVERAGE_MEALS.filter((m) => served.has(m));
}

/**
 * Portions the kitchen prepared per coverage meal on `day` (#1257): the sum of `actual_yield`,
 * or `served` when no yield was recorded, over the accepted `meal_service` docs. `null` when the
 * meal has none, so the caller can tell "nothing prepared" from "no record".
 */
export function preparedPortionsOfDay(
	day: string,
	services: readonly ServedService[],
	receipts: readonly ServedReceipt[]
): Record<(typeof COVERAGE_MEALS)[number], number | null> {
	const accepted = acceptedServicesOfDay(day, services, receipts);
	const prepared = { breakfast: null, lunch: null, dinner: null } as Record<
		(typeof COVERAGE_MEALS)[number],
		number | null
	>;
	for (const s of accepted) {
		if (s.meal !== 'breakfast' && s.meal !== 'lunch' && s.meal !== 'dinner') continue;
		prepared[s.meal] = (prepared[s.meal] ?? 0) + (s.actual_yield ?? s.served ?? 0);
	}
	return prepared;
}
