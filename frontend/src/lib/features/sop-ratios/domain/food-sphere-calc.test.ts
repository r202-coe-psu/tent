import { describe, it, expect } from 'vitest';
import { calculateTotalDailyDemand } from './food-sphere-calc';
import { DEFAULT_FOOD_SPHERE_STANDARDS } from './food-sphere.fixture';
import type { FoodSphereStandard } from './food-sphere';

describe('Food Sphere Calculation Engine', () => {
	it('calculates total daily demand correctly when exact segments match', () => {
		const headcounts = {
			ALL: 10,
			CHILD_2_5: 5,
			PREGNANT: 2
		};

		// For FOOD_ENERGY:
		// ALL (10 * 2100) = 21000
		// CHILD_2_5 (5 * 1250) = 6250
		// PREGNANT (2 * 2400) = 4800
		// Total = 32050
		const totalEnergy = calculateTotalDailyDemand(
			'FOOD_ENERGY',
			headcounts,
			DEFAULT_FOOD_SPHERE_STANDARDS
		);
		expect(totalEnergy).toBe(32050);
	});

	it('falls back to ALL segment when specific segment standard is missing (Invariant 8)', () => {
		const headcounts = {
			INFANT_6_23: 4 // Note: DEFAULT_FOOD_SPHERE_STANDARDS has FOOD_ENERGY for INFANT_6_23 (850), but NO FOOD_PROTEIN
		};

		// For FOOD_PROTEIN:
		// INFANT_6_23 has no specific standard -> fallback to ALL (53 g)
		// Total = 4 * 53 = 212
		const totalProtein = calculateTotalDailyDemand(
			'FOOD_PROTEIN',
			headcounts,
			DEFAULT_FOOD_SPHERE_STANDARDS
		);
		expect(totalProtein).toBe(212);
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

		// Looking for FOOD_PROTEIN which has no ALL standard in customStandards
		const headcounts = { ALL: 10, CHILD_2_5: 5 };
		const total = calculateTotalDailyDemand('FOOD_PROTEIN', headcounts, customStandards);
		expect(total).toBe(0);
	});

	it('ignores zero or negative headcounts', () => {
		const headcounts = {
			ALL: 0,
			CHILD_2_5: -5,
			PREGNANT: 2
		};
		// PREGNANT (2 * 2400) = 4800
		const total = calculateTotalDailyDemand(
			'FOOD_ENERGY',
			headcounts,
			DEFAULT_FOOD_SPHERE_STANDARDS
		);
		expect(total).toBe(4800);
	});
});
