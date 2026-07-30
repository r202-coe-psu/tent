/**
 * T-32 — presentation-only grouping of resource rows into a handful of categories for the
 * dashboard's category filter. Lives in the UI layer (not domain): it references SOP ratio key
 * names, which is a display concern, and the engine keeps `ResourceKey` deliberately generic.
 *
 * Unknown keys (non-SOP resources) fall back to `'other'`.
 */

export type ResourceCategory = 'water' | 'food' | 'sanitation' | 'shelter' | 'personnel' | 'other';

export const CATEGORY_LABELS: Record<ResourceCategory, string> = {
	water: 'น้ำ',
	food: 'อาหาร',
	sanitation: 'สุขาภิบาล',
	shelter: 'ที่พักพิง',
	personnel: 'กำลังคน',
	other: 'อื่น ๆ'
};

const KEY_CATEGORY: Record<string, ResourceCategory> = {
	water_l_per_person_day: 'water',
	drinking_water_l_per_person_day: 'water',
	cooking_water_l_per_person_day: 'water',
	hygiene_water_l_per_person_day: 'water',
	people_per_tap: 'water',
	people_per_handpump: 'water',
	people_per_open_well: 'water',
	max_waterpoint_distance_m: 'water',
	max_queue_minutes: 'water',
	kcal_per_adult_day: 'food',
	rice_g_per_person_meal: 'food',
	people_per_dining_point_adult: 'food',
	people_per_dining_point_child: 'food',
	people_per_laundry: 'sanitation',
	people_per_bathing: 'sanitation',
	people_per_toilet_female: 'sanitation',
	people_per_toilet_male: 'sanitation',
	m2_per_person_living: 'shelter',
	m2_per_person_living_cold: 'shelter',
	m2_per_person_total: 'shelter',
	people_per_volunteer: 'personnel'
};

/** Category for a resource key (defaults to `'other'` for anything not a known SOP key). */
export function categoryOf(key: string): ResourceCategory {
	return KEY_CATEGORY[key] ?? 'other';
}
