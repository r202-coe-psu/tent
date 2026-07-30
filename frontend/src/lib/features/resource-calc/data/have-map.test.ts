import { describe, expect, it } from 'vitest';
import type { SopRatioKey } from '$lib/features/sop-ratios';
import { resolveHave, type HaveMapSources } from './have-map';

const sources: HaveMapSources = {
	stock: new Map([['item:water', '120']]),
	shelter: {
		area_m2: 480,
		facilities: {
			water_points: 6,
			showers: 8,
			toilets_female: 10,
			toilets_male: 7
		}
	}
};

describe('resolveHave', () => {
	it.each([
		'water_l_per_person_day',
		'drinking_water_l_per_person_day',
		'cooking_water_l_per_person_day',
		'hygiene_water_l_per_person_day'
	] as SopRatioKey[])('maps %s to the interim item:water stock balance', (key) => {
		expect(resolveHave(key, sources)).toBe('120');
	});

	it('maps approved shelter facilities and area fields', () => {
		expect(resolveHave('people_per_tap', sources)).toBe('6');
		expect(resolveHave('people_per_bathing', sources)).toBe('8');
		expect(resolveHave('people_per_toilet_female', sources)).toBe('10');
		expect(resolveHave('people_per_toilet_male', sources)).toBe('7');
		expect(resolveHave('m2_per_person_living', sources)).toBe('480');
		expect(resolveHave('m2_per_person_living_cold', sources)).toBe('480');
		expect(resolveHave('m2_per_person_total', sources)).toBe('480');
	});

	it.each([
		'kcal_per_adult_day',
		'people_per_handpump',
		'people_per_open_well',
		'people_per_laundry',
		'people_per_dining_point_adult',
		'people_per_dining_point_child',
		'max_waterpoint_distance_m',
		'max_queue_minutes',
		'people_per_volunteer'
	] as SopRatioKey[])('returns null for %s without an approved R3 source', (key) => {
		expect(resolveHave(key, sources)).toBeNull();
	});

	it('returns null when an approved stock or shelter source is missing', () => {
		const missingSources: HaveMapSources = {
			stock: new Map(),
			shelter: { area_m2: null, facilities: {} }
		};
		expect(resolveHave('water_l_per_person_day', missingSources)).toBeNull();
		expect(resolveHave('people_per_tap', missingSources)).toBeNull();
		expect(resolveHave('m2_per_person_living', missingSources)).toBeNull();
	});

	it('returns null instead of passing through a negative water balance', () => {
		expect(
			resolveHave('water_l_per_person_day', { ...sources, stock: new Map([['item:water', '-1']]) })
		).toBeNull();
	});
});
