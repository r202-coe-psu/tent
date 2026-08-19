import type { SopRatioKey } from '$lib/features/sop-ratios';
import { qtyStrNonNegativeSchema } from '$lib/utils/qty';

/** Shelter fields approved as R3 `have` inputs by CR-042 OD-2. */
export interface ShelterHaveSource {
	area_m2: number | null;
	facilities: {
		water_points?: number | null;
		showers?: number | null;
		toilets_female?: number | null;
		toilets_male?: number | null;
	};
}

export interface HaveMapSources {
	stock: Map<string, string>;
	shelter: ShelterHaveSource;
}

const WATER_RATIO_KEYS = [
	'water_l_per_person_day',
	'drinking_water_l_per_person_day',
	'cooking_water_l_per_person_day',
	'hygiene_water_l_per_person_day'
] as const satisfies readonly SopRatioKey[];

const WATER_RATIO_KEY_SET = new Set<SopRatioKey>(WATER_RATIO_KEYS);

const AREA_RATIO_KEYS = [
	'm2_per_person_living',
	'm2_per_person_living_cold',
	'm2_per_person_total'
] as const satisfies readonly SopRatioKey[];

const NULL_HAVE_KEYS = [
	'kcal_per_adult_day',
	'people_per_handpump',
	'people_per_open_well',
	'people_per_laundry',
	'people_per_dining_point_adult',
	'people_per_dining_point_child',
	'max_waterpoint_distance_m',
	'max_queue_minutes',
	'people_per_volunteer'
] as const satisfies readonly SopRatioKey[];

function toQuantity(value: number | null | undefined): string | null {
	return value === null || value === undefined ? null : String(value);
}

function stockQuantity(value: string | undefined): string | null {
	return value && qtyStrNonNegativeSchema.safeParse(value).success ? value : null;
}

/**
 * CR-042 OD-2's fixed R3 map. This intentionally has no configuration surface:
 * a missing source is unknown (`null`), never an inferred zero.
 */
export function resolveHave(key: SopRatioKey, { stock, shelter }: HaveMapSources): string | null {
	if (WATER_RATIO_KEY_SET.has(key)) return stockQuantity(stock.get('item:water'));

	switch (key) {
		case 'people_per_tap':
			return toQuantity(shelter.facilities.water_points);
		case 'people_per_bathing':
			return toQuantity(shelter.facilities.showers);
		case 'people_per_toilet_female':
			return toQuantity(shelter.facilities.toilets_female);
		case 'people_per_toilet_male':
			return toQuantity(shelter.facilities.toilets_male);
		case 'm2_per_person_living':
		case 'm2_per_person_living_cold':
		case 'm2_per_person_total':
			return toQuantity(shelter.area_m2);
		default:
			return null;
	}
}

/** Static invariants of a persisted CR-042 have snapshot; live-source equality is verified separately. */
export function cr042HaveSnapshotIssues(snapshot: Record<string, string | null>): string[] {
	const issues: string[] = [];
	const water = snapshot[WATER_RATIO_KEYS[0]];
	for (const key of WATER_RATIO_KEYS.slice(1)) {
		if (snapshot[key] !== water) issues.push(`${key}: water keys must share item:water balance`);
	}

	const area = snapshot[AREA_RATIO_KEYS[0]];
	for (const key of AREA_RATIO_KEYS.slice(1)) {
		if (snapshot[key] !== area) issues.push(`${key}: area keys must share shelter area_m2`);
	}

	for (const key of NULL_HAVE_KEYS) {
		if (snapshot[key] !== null)
			issues.push(`${key}: CR-042 source is unavailable and must be null`);
	}
	return issues;
}
