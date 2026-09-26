import { describe, it, expect } from 'vitest';
import { calculateTotalDailyDemand, headcountsFromAgeGroups } from './food-sphere-calc';
import { DEFAULT_FOOD_SPHERE_STANDARDS } from './food-sphere.fixture';
import { targetSegmentSchema, type FoodSphereStandard } from './food-sphere';

describe('Food Sphere Calculation Engine', () => {
	it('calculates total daily demand correctly when exact segments match', () => {
		const headcounts = { ALL: 10, YOUNG_CHILD: 5, ELDERLY: 2 };
		const totalEnergy = calculateTotalDailyDemand(
			'FOOD_ENERGY',
			headcounts,
			DEFAULT_FOOD_SPHERE_STANDARDS
		);
		expect(totalEnergy).toBe(10 * 2100 + 5 * 1250 + 2 * 1900);
	});

	it('falls back to ALL segment when specific segment standard is missing (Invariant 8)', () => {
		const headcounts = { INFANT: 4 };
		const totalProtein = calculateTotalDailyDemand(
			'FOOD_PROTEIN',
			headcounts,
			DEFAULT_FOOD_SPHERE_STANDARDS
		);
		expect(totalProtein).toBe(4 * 53);
	});

	it('does not fallback across different req_group_id', () => {
		const customStandards: FoodSphereStandard[] = [
			{
				_id: 'food_sphere_standard:ALL:FOOD_ENERGY',
				type: 'food_sphere_standard',
				schema_v: 1,
				target_segment: 'ALL',
				req_group_id: 'FOOD_ENERGY',
				daily_demand: 2100,
				effective_date: '2026-07-16',
				source: 'SPHERE_BASELINE',
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			}
		];
		const headcounts = { ALL: 10, YOUNG_CHILD: 5 };
		const total = calculateTotalDailyDemand('FOOD_PROTEIN', headcounts, customStandards);
		expect(total).toBe(0);
	});

	it('ignores zero or negative headcounts', () => {
		const headcounts = { ALL: 0, YOUNG_CHILD: -5, ELDERLY: 2 };
		const total = calculateTotalDailyDemand(
			'FOOD_ENERGY',
			headcounts,
			DEFAULT_FOOD_SPHERE_STANDARDS
		);
		expect(total).toBe(2 * 1900);
	});

	it('ignores inactive standards during calculation', () => {
		const headcounts = { ALL: 10, ELDERLY: 2 };
		const standardsWithInactive: FoodSphereStandard[] = DEFAULT_FOOD_SPHERE_STANDARDS.map((s) =>
			s.target_segment === 'ELDERLY' && s.req_group_id === 'FOOD_ENERGY'
				? { ...s, status: 'inactive' }
				: s
		);
		const total = calculateTotalDailyDemand('FOOD_ENERGY', headcounts, standardsWithInactive);
		expect(total).toBe(10 * 2100 + 2 * 2100);
	});
});

describe('Target segments', () => {
	it('match the dashboard age groups plus ALL', () => {
		expect(targetSegmentSchema.options).toEqual([
			'ALL',
			'INFANT',
			'YOUNG_CHILD',
			'OLDER_CHILD',
			'TEEN',
			'ADULT',
			'ELDERLY'
		]);
	});

	it('rejects the removed segment codes', () => {
		for (const legacy of ['INFANT_0_6', 'INFANT_6_23', 'CHILD_2_5', 'PREGNANT', 'LACTATING']) {
			expect(targetSegmentSchema.safeParse(legacy).success).toBe(false);
		}
	});
});

describe('headcountsFromAgeGroups', () => {
	const ageGroups = {
		'<1': 1,
		'1-5': 2,
		'6-11': 3,
		'12-19': 4,
		'20-59': 5,
		'60+': 6,
		unknown: 7
	};

	it('maps each dashboard age bucket to its segment and leaves the rest in ALL', () => {
		expect(headcountsFromAgeGroups(28, ageGroups)).toEqual({
			INFANT: 1,
			YOUNG_CHILD: 2,
			OLDER_CHILD: 3,
			TEEN: 4,
			ADULT: 5,
			ELDERLY: 6,
			ALL: 7
		});
	});

	it('counts every person exactly once', () => {
		const headcounts = headcountsFromAgeGroups(28, ageGroups);
		const sum = Object.values(headcounts).reduce((acc, n) => acc + (n ?? 0), 0);
		expect(sum).toBe(28);
	});

	it('puts everyone in ALL when demographics are not loaded', () => {
		expect(headcountsFromAgeGroups(9)).toEqual({ ALL: 9 });
	});

	it('never returns a negative ALL when age buckets exceed occupancy', () => {
		expect(headcountsFromAgeGroups(3, { '20-59': 5 }).ALL).toBe(0);
	});
});
