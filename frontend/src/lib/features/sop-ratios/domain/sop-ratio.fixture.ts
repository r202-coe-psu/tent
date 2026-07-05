import type { SopRatioKey } from './sop-ratio';

/**
 * Default ratios representing the Sphere Baseline and standard guidelines.
 * These values align with the ratified defaults in the SOP Ratio Reference Table.
 * @see docs/source/handbooks/sop-ratio-reference-table.md
 * @see docs/changes/CR-026-sop-ratio-catalog-scope-and-history-ratification.md
 */
export const validRatios: Record<SopRatioKey, number> = {
	water_l_per_person_day: 15,
	drinking_water_l_per_person_day: 3,
	cooking_water_l_per_person_day: 6,
	hygiene_water_l_per_person_day: 6,
	kcal_per_adult_day: 2000,
	people_per_tap: 80,
	people_per_handpump: 500,
	people_per_open_well: 400,
	people_per_laundry: 100,
	people_per_bathing: 50,
	people_per_toilet_female: 20,
	people_per_toilet_male: 35,
	people_per_dining_point_adult: 20,
	people_per_dining_point_child: 10,
	m2_per_person_living: 3.5,
	m2_per_person_living_cold: 4.5,
	m2_per_person_total: 45,
	max_waterpoint_distance_m: 500,
	max_queue_minutes: 30,
	people_per_volunteer: 50
};
