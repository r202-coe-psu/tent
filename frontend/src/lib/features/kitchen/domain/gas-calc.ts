import { parseQty, persistQty, qtyGt, type QtyValue } from '$lib/utils/qty';
import type { GasCylinderType } from './kitchen';

/** The coefficients the gas formula needs — a `gas_cylinder_type` doc satisfies this. */
export type GasBurnCoefficients = Pick<
	GasCylinderType,
	'burn_rate_kg_per_hour' | 'time_multiplier'
>;

/**
 * Calculates gas consumption: Cooking Time (hrs) × Burn Rate (kg/hr) × Multiplier.
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
 * Calculates ceiling count of full gas cylinders needed for a given consumption.
 */
export function cylindersNeeded(consumptionKg: QtyValue, capacityKg: QtyValue): number {
	if (!qtyGt(capacityKg, 0)) {
		throw new Error('cylindersNeeded: capacityKg must be positive');
	}
	return parseQty(consumptionKg).div(capacityKg).ceil().toNumber();
}

/**
 * Inversely calculates estimated cooking hours from consumption and cylinder burn coefficients.
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

/** ชม. ทำอาหารสูงสุดที่แก๊สคงเหลือรองรับได้ (ปัดลง 1 ตำแหน่งทศนิยม) */
export function calculateMaxCookingHours(
	remainingKg: QtyValue,
	cylinder?: GasBurnCoefficients | null
): string {
	if (!cylinder) return '999.0';
	const rem = parseQty(remainingKg);
	if (rem.isNegative() || rem.isZero()) return '0.0';
	const hours = cookingHoursFromConsumptionKg(rem, cylinder);
	const val = parseFloat(hours);
	return (Math.floor(val * 10) / 10).toFixed(1);
}

/** ชม. ทำอาหารจากจำนวน portions ตามสูตรมาตรฐาน (ปัดเศษ 1 ตำแหน่ง) */
export function calculateCookingHoursFromPortions(
	recipe?: {
		standard_portions?: string | number;
		standard_duration_hours?: string | number;
	} | null,
	portions?: number | null
): string | null {
	if (!recipe || portions == null || portions <= 0) return null;
	const stdPortions = parseFloat(String(recipe.standard_portions)) || 0;
	const stdHours = parseFloat(String(recipe.standard_duration_hours)) || 0;
	if (stdPortions <= 0 || stdHours <= 0) return null;

	const hours = (portions * stdHours) / stdPortions;
	const rounded = Math.max(0.1, Math.round(hours * 10) / 10);
	return rounded.toFixed(1);
}
