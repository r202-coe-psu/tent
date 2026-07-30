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

const WATER_RATIO_KEYS = new Set<SopRatioKey>([
	'water_l_per_person_day',
	'drinking_water_l_per_person_day',
	'cooking_water_l_per_person_day',
	'hygiene_water_l_per_person_day'
]);

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
	if (WATER_RATIO_KEYS.has(key)) return stockQuantity(stock.get('item:water'));

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
