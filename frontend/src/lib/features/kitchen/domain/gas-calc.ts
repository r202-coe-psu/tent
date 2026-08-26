import { parseQty, persistQty, qtyGt, type QtyValue } from '$lib/utils/qty';
import type { GasCylinderType } from './kitchen';

/** The coefficients the gas formula needs — a `gas_cylinder_type` doc satisfies this. */
export type GasBurnCoefficients = Pick<
	GasCylinderType,
	'burn_rate_kg_per_hour' | 'time_multiplier'
>;

/**
 * Gas Consumption (kg) = Cooking Time (hrs) × Burn Rate (kg/hr) × Multiplier — CR-058 §2.2.
 * All three factors are qty_str; multiplied as Decimal and rounded ONCE at the end
 * (`persistQty`) so a 4dp × 4dp × 4dp product never carries IEEE noise.
 *
 * Persisted on `meal_plan.gas_usage[].consumption_kg` (CR-085) and drawn down via
 * `gas_ledger` at requisition time.
 */
export function calculateGasConsumptionKg(
	cookingHours: QtyValue,
	cylinder: GasBurnCoefficients
): string {
	if (parseQty(cookingHours).isNegative()) {
		throw new Error('calculateGasConsumptionKg: cookingHours must not be negative');
	}
	if (!qtyGt(cylinder.burn_rate_kg_per_hour, 0)) {
		throw new Error('calculateGasConsumptionKg: burn_rate_kg_per_hour must be positive');
	}
	if (!qtyGt(cylinder.time_multiplier, 0)) {
		throw new Error('calculateGasConsumptionKg: time_multiplier must be positive');
	}
	return persistQty(
		parseQty(cookingHours).mul(cylinder.burn_rate_kg_per_hour).mul(cylinder.time_multiplier)
	);
}

/**
 * Full cylinders needed to cover `consumptionKg` (ceil). A plain count (not qty_str) —
 * the same class as `headcount`/`served`, never a stock-ledger quantity itself.
 */
export function cylindersNeeded(consumptionKg: QtyValue, capacityKg: QtyValue): number {
	if (!qtyGt(capacityKg, 0)) {
		throw new Error('cylindersNeeded: capacityKg must be positive');
	}
	return parseQty(consumptionKg).div(capacityKg).ceil().toNumber();
}

/**
 * Inverse of {@link calculateGasConsumptionKg} — recovers the cooking-hours input
 * from a persisted `consumption_kg` + the cylinder's own coefficients. Only
 * `consumption_kg` is stored on `meal_plan.gas_usage` (CR-085 didn't add a
 * separate hours field), so re-opening a plan for edit needs this to show the
 * hours field pre-filled instead of blank — the result reproduces the exact same
 * `consumption_kg` if fed back into calculateGasConsumptionKg, even if it isn't
 * bit-for-bit the original typed value (immaterial since only consumption_kg is
 * ever persisted or compared).
 */
export function cookingHoursFromConsumptionKg(
	consumptionKg: QtyValue,
	cylinder: GasBurnCoefficients
): string {
	if (!qtyGt(cylinder.burn_rate_kg_per_hour, 0)) {
		throw new Error('cookingHoursFromConsumptionKg: burn_rate_kg_per_hour must be positive');
	}
	if (!qtyGt(cylinder.time_multiplier, 0)) {
		throw new Error('cookingHoursFromConsumptionKg: time_multiplier must be positive');
	}
	return persistQty(
		parseQty(consumptionKg).div(cylinder.burn_rate_kg_per_hour).div(cylinder.time_multiplier)
	);
}
