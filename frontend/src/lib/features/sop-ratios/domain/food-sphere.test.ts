import { describe, it, expect } from 'vitest';
import {
	FOOD_SPHERE_STANDARD_SCHEMA_VERSION,
	foodSphereStandardInputSchema,
	normalizeFoodSphereStandard,
	type FoodSphereStandard
} from './food-sphere';
import { DEFAULT_FOOD_SPHERE_STANDARDS } from './food-sphere.fixture';

function standardInput(daily_demand: unknown) {
	return {
		target_segment: 'ALL',
		req_group_id: 'FOOD_ENERGY',
		daily_demand,
		effective_date: '2026-07-16'
	};
}

describe('foodSphereStandardInputSchema daily_demand (#936)', () => {
	it('stores a numeric daily_demand as a qty string', () => {
		const parsed = foodSphereStandardInputSchema.parse(standardInput(2100));
		expect(parsed.daily_demand).toBe('2100');
	});

	it('accepts a fractional string daily_demand', () => {
		const parsed = foodSphereStandardInputSchema.parse(standardInput('0.25'));
		expect(parsed.daily_demand).toBe('0.25');
	});

	it.each([0, '-1', 'abc'])('rejects daily_demand %s', (daily_demand) => {
		expect(foodSphereStandardInputSchema.safeParse(standardInput(daily_demand)).success).toBe(
			false
		);
	});
});

describe('FOOD_SPHERE_STANDARD_SCHEMA_VERSION (#936)', () => {
	it('is 3', () => {
		expect(FOOD_SPHERE_STANDARD_SCHEMA_VERSION).toBe(3);
	});
});

describe('foodSphereStandardInputSchema rounding and messages (#936)', () => {
	it.each(['0.00001', '0.00004'])('rejects %s (rounds to 0) with the Thai message', (v) => {
		const result = foodSphereStandardInputSchema.safeParse(standardInput(v));
		expect(result.success).toBe(false);
		expect(result.error?.issues.map((i) => i.message)).toContain(
			'ปริมาณความต้องการต้องไม่น้อยกว่า 0.0001'
		);
	});

	it('accepts 0.0001', () => {
		expect(foodSphereStandardInputSchema.parse(standardInput('0.0001')).daily_demand).toBe(
			'0.0001'
		);
	});

	it('uses the Thai message for zero', () => {
		const result = foodSphereStandardInputSchema.safeParse(standardInput(0));
		expect(result.error?.issues[0].message).toBe('ปริมาณความต้องการต้องไม่น้อยกว่า 0.0001');
	});
});

describe('normalizeFoodSphereStandard (#936)', () => {
	const base = DEFAULT_FOOD_SPHERE_STANDARDS[0];
	const legacy = (daily_demand: unknown, status?: 'active' | 'inactive') =>
		({ ...base, schema_v: 2, daily_demand, status }) as unknown as FoodSphereStandard;

	it('converts a legacy number to a string without rounding', () => {
		expect(normalizeFoodSphereStandard(legacy(6.33333)).daily_demand).toBe('6.33333');
	});

	it('does not use exponent notation for tiny legacy numbers', () => {
		expect(normalizeFoodSphereStandard(legacy(1e-7)).daily_demand).toBe('0.0000001');
	});

	it('leaves a string unchanged', () => {
		expect(normalizeFoodSphereStandard(legacy('2100')).daily_demand).toBe('2100');
	});

	it('defaults a missing status to active and keeps an existing one', () => {
		expect(normalizeFoodSphereStandard(legacy('1')).status).toBe('active');
		expect(normalizeFoodSphereStandard(legacy('1', 'inactive')).status).toBe('inactive');
	});
});
