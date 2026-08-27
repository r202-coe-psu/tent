import { describe, it, expect } from 'vitest';
import {
	calculateGasConsumptionKg,
	cookingHoursFromConsumptionKg,
	cylindersNeeded
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
