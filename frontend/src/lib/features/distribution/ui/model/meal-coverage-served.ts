import { mealServiceReceiptOutcome } from '$lib/features/kitchen';
import type { MealPeriod } from '../../domain/food-supplies';
import { COVERAGE_MEALS } from '../../domain/food-supplies/meal-coverage';

interface ServedService {
	_id: string;
	date: string;
	meal: MealPeriod;
}

interface ServedReceipt {
	meal_service_id: string;
	outcome?: 'confirmed' | 'rejected';
	created_at: string;
}

/**
 * Coverage meals already served on `day`: at least one `meal_service` of that meal that its
 * warehouse receipt did not reject. A `meal_service` with no receipt yet counts as served.
 */
export function servedMealsOfDay(
	day: string,
	services: readonly ServedService[],
	receipts: readonly ServedReceipt[]
): MealPeriod[] {
	// Receipts are append-only, so a re-decision adds one: the latest wins.
	const latest = new Map<string, ServedReceipt>();
	for (const r of receipts) {
		const seen = latest.get(r.meal_service_id);
		if (!seen || r.created_at >= seen.created_at) latest.set(r.meal_service_id, r);
	}
	const served = new Set<MealPeriod>();
	for (const s of services) {
		if (s.date !== day) continue;
		const receipt = latest.get(s._id);
		if (receipt && mealServiceReceiptOutcome(receipt) === 'rejected') continue;
		served.add(s.meal);
	}
	return COVERAGE_MEALS.filter((m) => served.has(m));
}
