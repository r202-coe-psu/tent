import { describe, it, expect } from 'vitest';
import { computeMealVariance, VARIANCE_TOLERANCE_PCT } from './meal-variance';
import type { MealPlan, MealService } from './kitchen';

// Minimal fixtures — only the fields computeMealVariance reads. Cast keeps the
// test focused on the variance math, not the full BaseDoc envelope.
function plan(total: number): MealPlan {
	return { headcount: { total, halal: 0, soft_food: 0, infant: 0 } } as MealPlan;
}

function service(over: Partial<MealService> = {}): MealService {
	return {
		served: 0,
		waste: 0,
		external: { volunteers: 0, outside_evacuees: 0 },
		...over
	} as MealService;
}

describe('computeMealVariance', () => {
	it('served equal to planned is on_target with zero variance', () => {
		const v = computeMealVariance(service({ served: 100 }), plan(100));
		expect(v.planned).toBe(100);
		expect(v.variance).toBe(0);
		expect(v.variance_pct).toBe(0);
		expect(v.status).toBe('on_target');
	});

	it('served more than planned (beyond tolerance) is over with positive variance', () => {
		const v = computeMealVariance(service({ served: 120 }), plan(100));
		expect(v.variance).toBe(20);
		expect(v.variance_pct).toBe(20);
		expect(v.status).toBe('over');
	});

	it('served fewer than planned (beyond tolerance) is under with negative variance', () => {
		const v = computeMealVariance(service({ served: 80 }), plan(100));
		expect(v.variance).toBe(-20);
		expect(v.variance_pct).toBe(-20);
		expect(v.status).toBe('under');
	});

	it('within ±tolerance counts as on_target on both sides', () => {
		// tolerance defaults to 5% → planned 100 tolerates 95..105 served
		expect(computeMealVariance(service({ served: 105 }), plan(100)).status).toBe('on_target');
		expect(computeMealVariance(service({ served: 95 }), plan(100)).status).toBe('on_target');
		// one past the band flips to over/under
		expect(computeMealVariance(service({ served: 106 }), plan(100)).status).toBe('over');
		expect(computeMealVariance(service({ served: 94 }), plan(100)).status).toBe('under');
	});

	it('honours a custom tolerance', () => {
		expect(computeMealVariance(service({ served: 110 }), plan(100), 10).status).toBe('on_target');
		expect(computeMealVariance(service({ served: 111 }), plan(100), 10).status).toBe('over');
	});

	it('sums external support from volunteers + outside_evacuees', () => {
		const v = computeMealVariance(
			service({ served: 100, external: { volunteers: 5, outside_evacuees: 8 } }),
			plan(100)
		);
		expect(v.external).toBe(13);
	});

	it('produced = served + waste (in-center cooked estimate)', () => {
		const v = computeMealVariance(service({ served: 90, waste: 12 }), plan(100));
		expect(v.produced).toBe(102);
	});

	it('no matching plan → no_plan, null pct, neutral variance', () => {
		const v = computeMealVariance(service({ served: 40, waste: 2 }), null);
		expect(v.planned).toBeNull();
		expect(v.variance).toBe(0);
		expect(v.variance_pct).toBeNull();
		expect(v.status).toBe('no_plan');
		// raw actuals still reported for review
		expect(v.served).toBe(40);
		expect(v.produced).toBe(42);
	});

	it('zero-headcount plan is treated as no_plan (cannot divide by 0)', () => {
		const v = computeMealVariance(service({ served: 10 }), plan(0));
		expect(v.variance_pct).toBeNull();
		expect(v.status).toBe('no_plan');
	});

	it('exposes the default tolerance constant', () => {
		expect(VARIANCE_TOLERANCE_PCT).toBe(5);
	});
});
