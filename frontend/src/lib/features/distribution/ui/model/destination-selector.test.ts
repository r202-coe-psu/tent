import { describe, expect, it } from 'vitest';
import {
	buildDestinationOptionGroups,
	resolveDestinationSelection,
	CUSTOM_DESTINATION_SENTINEL
} from './destination-selector';
import type { Shelter } from '$lib/features/shelters';

type PartialShelter = Pick<Shelter, 'zones' | 'food_distribution_points'>;

describe('buildDestinationOptionGroups', () => {
	it('returns empty groups when shelter is undefined', () => {
		expect(buildDestinationOptionGroups(undefined)).toEqual({
			zones: [],
			foodDistributionPoints: []
		});
	});

	it('groups zones and food distribution points separately', () => {
		const shelter = {
			zones: [{ name: 'เต็นท์โซน A' }, { name: 'เต็นท์โซน B' }],
			food_distribution_points: [{ name: 'โรงอาหารกลาง' }]
		} as unknown as PartialShelter;

		const groups = buildDestinationOptionGroups(shelter);

		expect(groups.zones).toEqual([
			{ value: 'เต็นท์โซน A', label: 'เต็นท์โซน A' },
			{ value: 'เต็นท์โซน B', label: 'เต็นท์โซน B' }
		]);
		expect(groups.foodDistributionPoints).toEqual([
			{ value: 'โรงอาหารกลาง', label: 'โรงอาหารกลาง' }
		]);
	});

	it('drops a food distribution point that shares a display name with a zone (zone wins)', () => {
		const shelter = {
			zones: [{ name: 'จุดกลาง' }],
			food_distribution_points: [{ name: 'จุดกลาง' }, { name: 'โรงอาหาร 2' }]
		} as unknown as PartialShelter;

		const groups = buildDestinationOptionGroups(shelter);

		expect(groups.zones).toEqual([{ value: 'จุดกลาง', label: 'จุดกลาง' }]);
		expect(groups.foodDistributionPoints).toEqual([{ value: 'โรงอาหาร 2', label: 'โรงอาหาร 2' }]);
	});

	it('skips zones/points with an empty name', () => {
		const shelter = {
			zones: [{ name: '' }, { name: 'โซน C' }],
			food_distribution_points: [{ name: '' }]
		} as unknown as PartialShelter;

		const groups = buildDestinationOptionGroups(shelter);

		expect(groups.zones).toEqual([{ value: 'โซน C', label: 'โซน C' }]);
		expect(groups.foodDistributionPoints).toEqual([]);
	});
});

describe('resolveDestinationSelection', () => {
	it('resolves a known destination selection to itself', () => {
		expect(resolveDestinationSelection('เต็นท์โซน A', '')).toBe('เต็นท์โซน A');
	});

	it('resolves the custom sentinel to the trimmed manual text', () => {
		expect(resolveDestinationSelection(CUSTOM_DESTINATION_SENTINEL, '  จุดพยาบาลชั่วคราว  ')).toBe(
			'จุดพยาบาลชั่วคราว'
		);
	});

	it('never returns the sentinel itself', () => {
		const resolved = resolveDestinationSelection(CUSTOM_DESTINATION_SENTINEL, '');
		expect(resolved).not.toBe(CUSTOM_DESTINATION_SENTINEL);
		expect(resolved).toBe('');
	});
});
