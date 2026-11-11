import { describe, it, expect } from 'vitest';
import {
	calculateTotalDailyDemand,
	calculateTotalDailyDemandDecimal,
	headcountsFromAgeGroups
} from './food-sphere-calc';
import { DEFAULT_FOOD_SPHERE_STANDARDS } from './food-sphere.fixture';
import { targetSegmentSchema, type FoodSphereStandard } from './food-sphere';

/** Minimal active standard for decimal-precision cases (#936). */
function makeStandard(
	segment: FoodSphereStandard['target_segment'],
	dailyDemand: unknown,
	over: Partial<FoodSphereStandard> = {}
): FoodSphereStandard {
	return {
		_id: `food_sphere_standard:${segment}:TEST_GROUP`,
		type: 'food_sphere_standard',
		schema_v: 3,
		target_segment: segment,
		req_group_id: 'TEST_GROUP',
		daily_demand: dailyDemand as string,
		effective_date: '2026-07-16',
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system',
		...over
	};
}

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
				schema_v: 3,
				target_segment: 'ALL',
				req_group_id: 'FOOD_ENERGY',
				daily_demand: '2100',
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

describe('Food Sphere decimal daily demand (#936)', () => {
	it('keeps 0.3 x 3 exact in the Decimal variant (float would give 0.8999999999999999)', () => {
		const standards = [makeStandard('ALL', '0.3')];
		expect(calculateTotalDailyDemandDecimal('TEST_GROUP', { ALL: 3 }, standards).toString()).toBe(
			'0.9'
		);
	});

	it('returns the same number through the kept number API', () => {
		const standards = [makeStandard('ALL', '0.3')];
		expect(calculateTotalDailyDemand('TEST_GROUP', { ALL: 3 }, standards)).toBe(0.9);
	});

	it('treats a legacy number daily_demand the same as its string form', () => {
		const legacy = calculateTotalDailyDemandDecimal('TEST_GROUP', { ALL: 2 }, [
			makeStandard('ALL', 2100)
		]);
		const modern = calculateTotalDailyDemandDecimal('TEST_GROUP', { ALL: 2 }, [
			makeStandard('ALL', '2100')
		]);
		expect(legacy.toString()).toBe('4200');
		expect(modern.toString()).toBe('4200');
	});

	it('falls back to the ALL standard with string values', () => {
		const total = calculateTotalDailyDemandDecimal('TEST_GROUP', { INFANT: 4 }, [
			makeStandard('ALL', '53')
		]);
		expect(total.toString()).toBe('212');
	});

	it('skips inactive standards and uses ALL instead', () => {
		const standards = [
			makeStandard('ALL', '2100'),
			makeStandard('ELDERLY', '1900', { status: 'inactive' })
		];
		const total = calculateTotalDailyDemandDecimal(
			'TEST_GROUP',
			{ ALL: 10, ELDERLY: 2 },
			standards
		);
		expect(total.toString()).toBe('25200');
	});

	it('skips a standard whose daily_demand is "0"', () => {
		const total = calculateTotalDailyDemandDecimal('TEST_GROUP', { ALL: 5 }, [
			makeStandard('ALL', '0')
		]);
		expect(total.toString()).toBe('0');
	});

	it('sums multiple segments exactly: 3 x 0.1 + 3 x 0.2 = 0.9', () => {
		const standards = [makeStandard('ADULT', '0.1'), makeStandard('ELDERLY', '0.2')];
		const total = calculateTotalDailyDemandDecimal(
			'TEST_GROUP',
			{ ADULT: 3, ELDERLY: 3 },
			standards
		);
		expect(total.toString()).toBe('0.9');
	});
});
