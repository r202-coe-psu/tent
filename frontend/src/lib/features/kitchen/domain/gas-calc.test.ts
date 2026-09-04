import { describe, it, expect } from 'vitest';
import {
	calculateGasConsumptionKg,
	cookingHoursFromConsumptionKg,
	cylindersNeeded,
	calculateMaxCookingHours,
	calculateCookingHoursFromPortions
} from './gas-calc';

const cylinder = (burn_rate_kg_per_hour: string, time_multiplier: string) => ({
	burn_rate_kg_per_hour,
	time_multiplier
});

describe('calculateGasConsumptionKg (CR-058 §2.2)', () => {
	it('worked example from CR-058: 2 hrs × 1.5 kg/hr × 1.0 = 3 kg', () => {
		expect(calculateGasConsumptionKg('2', cylinder('1.5', '1'))).toBe('3');
	});

	it('applies the time multiplier (2 × 1.5 × 1.25 = 3.75)', () => {
		expect(calculateGasConsumptionKg('2', cylinder('1.5', '1.25'))).toBe('3.75');
	});

	it('accepts qty_str coefficients verbatim from a gas_cylinder_type doc', () => {
		expect(calculateGasConsumptionKg('4', cylinder('0.75', '1'))).toBe('3');
	});

	it('returns a qty_str with ≤4 decimals — rounds once at the end', () => {
		const result = calculateGasConsumptionKg('3', cylinder('0.33333', '1'));
		expect(result).toMatch(/^\d+(\.\d{1,4})?$/);
	});

	it('does not accumulate float noise (0.1 × 0.3 × 3 = exactly "0.09")', () => {
		expect(calculateGasConsumptionKg('0.1', cylinder('0.3', '3'))).toBe('0.09');
	});

	it('cooking time 0 yields "0" kg', () => {
		expect(calculateGasConsumptionKg('0', cylinder('1.5', '1'))).toBe('0');
	});

	it('throws on negative cooking time', () => {
		expect(() => calculateGasConsumptionKg('-1', cylinder('1.5', '1'))).toThrow(
			/must not be negative/
		);
	});

	it('throws when burn_rate_kg_per_hour is not positive', () => {
		expect(() => calculateGasConsumptionKg('2', cylinder('0', '1'))).toThrow(
			/burn_rate_kg_per_hour must be positive/
		);
	});

	it('throws when time_multiplier is not positive', () => {
		expect(() => calculateGasConsumptionKg('2', cylinder('1.5', '0'))).toThrow(
			/time_multiplier must be positive/
		);
	});
});

describe('cylindersNeeded', () => {
	it('rounds up to whole cylinders (3.1 kg / 15 kg = 1)', () => {
		expect(cylindersNeeded('3.1', '15')).toBe(1);
	});

	it('an exact multiple needs no extra cylinder (30 / 15 = 2)', () => {
		expect(cylindersNeeded('30', '15')).toBe(2);
	});

	it('a non-exact multiple ceils up (16 / 15 = 2)', () => {
		expect(cylindersNeeded('16', '15')).toBe(2);
	});

	it('0 kg needs 0 cylinders', () => {
		expect(cylindersNeeded('0', '15')).toBe(0);
	});

	it('throws on non-positive capacity', () => {
		expect(() => cylindersNeeded('10', '0')).toThrow(/capacityKg must be positive/);
	});
});

describe('cookingHoursFromConsumptionKg (inverse of calculateGasConsumptionKg)', () => {
	it('recovers the worked example: 3 kg back to 2 hrs (1.5 kg/hr × 1.0)', () => {
		expect(cookingHoursFromConsumptionKg('3', cylinder('1.5', '1'))).toBe('2');
	});

	it('recovers hours with a time multiplier applied (3.75 kg back to 2 hrs)', () => {
		expect(cookingHoursFromConsumptionKg('3.75', cylinder('1.5', '1.25'))).toBe('2');
	});

	it('round-trips through calculateGasConsumptionKg for an arbitrary input', () => {
		const consumption = calculateGasConsumptionKg('2.5', cylinder('0.7', '1.1'));
		const hours = cookingHoursFromConsumptionKg(consumption, cylinder('0.7', '1.1'));
		expect(calculateGasConsumptionKg(hours, cylinder('0.7', '1.1'))).toBe(consumption);
	});

	it('0 kg recovers to 0 hours', () => {
		expect(cookingHoursFromConsumptionKg('0', cylinder('1.5', '1'))).toBe('0');
	});

	it('throws when burn_rate_kg_per_hour is not positive', () => {
		expect(() => cookingHoursFromConsumptionKg('3', cylinder('0', '1'))).toThrow(
			/burn_rate_kg_per_hour must be positive/
		);
	});

	it('throws when time_multiplier is not positive', () => {
		expect(() => cookingHoursFromConsumptionKg('3', cylinder('1.5', '0'))).toThrow(
			/time_multiplier must be positive/
		);
	});
});

describe('calculateMaxCookingHours', () => {
	it('calculates max cooking hours floored to 1 decimal place', () => {
		// 15 kg remaining, burn rate 0.5 kg/h, multiplier 1.0 -> 30.0 hours
		expect(calculateMaxCookingHours('15', cylinder('0.5', '1'))).toBe('30.0');
		// 15.35 kg remaining, burn rate 0.5 kg/h -> 30.7 hours
		expect(calculateMaxCookingHours('15.35', cylinder('0.5', '1'))).toBe('30.7');
	});

	it('returns 0.0 when remaining is 0 or negative', () => {
		expect(calculateMaxCookingHours('0', cylinder('0.5', '1'))).toBe('0.0');
		expect(calculateMaxCookingHours('-5', cylinder('0.5', '1'))).toBe('0.0');
	});

	it('returns fallback 999.0 when cylinder is null or undefined', () => {
		expect(calculateMaxCookingHours('15', null)).toBe('999.0');
		expect(calculateMaxCookingHours('15', undefined)).toBe('999.0');
	});
});

describe('calculateCookingHoursFromPortions', () => {
	const recipe = { standard_portions: '100', standard_duration_hours: '1' };

	it('calculates hours scaled by portions and rounded to 1 decimal place', () => {
		// 100 portions = 1 hr -> 50 portions = 0.5 hr
		expect(calculateCookingHoursFromPortions(recipe, 50)).toBe('0.5');
		// 38 portions -> 0.4 hr (38 / 100 = 0.38 -> 0.4)
		expect(calculateCookingHoursFromPortions(recipe, 38)).toBe('0.4');
		// 380 portions -> 3.8 hr
		expect(calculateCookingHoursFromPortions(recipe, 380)).toBe('3.8');
	});

	it('enforces minimum 0.1 hours', () => {
		expect(calculateCookingHoursFromPortions(recipe, 1)).toBe('0.1');
	});

	it('returns null on invalid recipe or missing portions', () => {
		expect(calculateCookingHoursFromPortions(null, 50)).toBeNull();
		expect(calculateCookingHoursFromPortions(recipe, 0)).toBeNull();
		expect(calculateCookingHoursFromPortions(recipe, null)).toBeNull();
		expect(
			calculateCookingHoursFromPortions(
				{ standard_portions: '0', standard_duration_hours: '1' },
				50
			)
		).toBeNull();
	});
});
