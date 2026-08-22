import { describe, it, expect } from 'vitest';
import {
	computeMealVariance,
	VARIANCE_TOLERANCE_PCT,
	MEAL_VARIANCE_STATUS_LABELS
} from './meal-variance';
import type { MealVarianceStatus } from './meal-variance';
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

	it('passes actual_yield through when recorded (CR-084)', () => {
		const v = computeMealVariance(service({ served: 85, actual_yield: 90 }), plan(100));
		expect(v.actual_yield).toBe(90);
	});

	it('actual_yield is null on a service with no yield recorded (pre-CR-084 doc)', () => {
		const v = computeMealVariance(service({ served: 85 }), plan(100));
		expect(v.actual_yield).toBeNull();
	});

	it('yield_variance = actual_yield − planned', () => {
		const v = computeMealVariance(service({ served: 85, actual_yield: 90 }), plan(100));
		expect(v.yield_variance).toBe(-10);
	});

	it('yield_variance is null when there is no plan', () => {
		const v = computeMealVariance(service({ served: 85, actual_yield: 90 }), null);
		expect(v.yield_variance).toBeNull();
		expect(v.actual_yield).toBe(90);
	});

	it('yield_variance is null when actual_yield is absent', () => {
		const v = computeMealVariance(service({ served: 85 }), plan(100));
		expect(v.yield_variance).toBeNull();
	});

	it('actual_yield does not change variance / variance_pct / status', () => {
		const v = computeMealVariance(service({ served: 80, actual_yield: 200 }), plan(100));
		expect(v.variance).toBe(-20);
		expect(v.variance_pct).toBe(-20);
		expect(v.status).toBe('under');
	});

	it('produced stays served + waste even when actual_yield is recorded', () => {
		const v = computeMealVariance(service({ served: 90, waste: 12, actual_yield: 200 }), plan(100));
		expect(v.produced).toBe(102);
	});

	it('no_plan branch still reports actual_yield', () => {
		const v = computeMealVariance(service({ served: 40, waste: 2, actual_yield: 45 }), null);
		expect(v.status).toBe('no_plan');
		expect(v.actual_yield).toBe(45);
		expect(v.yield_variance).toBeNull();
	});

	it('exposes a Thai label for every variance status', () => {
		const statuses: MealVarianceStatus[] = ['on_target', 'over', 'under', 'no_plan'];
		for (const s of statuses) {
			expect(MEAL_VARIANCE_STATUS_LABELS[s]).toBeTruthy();
		}
		expect(Object.keys(MEAL_VARIANCE_STATUS_LABELS)).toHaveLength(4);
	});
});
