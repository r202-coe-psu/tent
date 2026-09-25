import { describe, expect, it } from 'vitest';
import type { PetGroup } from '../../domain/people';
import {
	createPetCard,
	getPetTitle,
	parseInitialPets,
	syncPetsToHousehold
} from './unified-registration-pets';

describe('parseInitialPets', () => {
	it('expands dog/cat groups by count and parses name from notes', () => {
		const pets: PetGroup[] = [
			{ species: 'dog', count: 2, notes: 'ชื่อ: Buddy | brown', has_cage: true },
			{ species: 'cat', count: 1, notes: 'ชื่อ: Mochi', has_cage: false }
		];
		const { items, nextId } = parseInitialPets(pets);
		expect(items).toHaveLength(3);
		expect(nextId).toBe(4);
		expect(items[0]).toMatchObject({
			id: 1,
			species: 'dog',
			name: 'Buddy',
			details: 'brown',
			has_cage: true,
			customSpecies: ''
		});
		expect(items[1]).toMatchObject({
			id: 2,
			species: 'dog',
			name: 'Buddy',
			details: 'brown'
		});
		expect(items[2]).toMatchObject({
			id: 3,
			species: 'cat',
			name: 'Mochi',
			details: '',
			has_cage: false
		});
	});

	it('parses other pets with customSpecies as first non-name note part', () => {
		const pets: PetGroup[] = [
			{
				species: 'other',
				count: 1,
				notes: 'กระต่าย | ชื่อ: Fluffy | soft ears',
				has_cage: true,
				image_url: 'image:abc'
			}
		];
		const { items } = parseInitialPets(pets, 10);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: 10,
			species: 'other',
			customSpecies: 'กระต่าย',
			name: 'Fluffy',
			details: 'soft ears',
			has_cage: true,
			image_url: 'image:abc'
		});
	});
});

describe('syncPetsToHousehold', () => {
	it('roundtrips dog/cat/other cards into PetGroup notes packing', () => {
		const items = [
			{
				...createPetCard('dog', 1),
				name: 'Buddy',
				details: 'brown',
				has_cage: true
			},
			{
				...createPetCard('cat', 2),
				name: 'Mochi'
			},
			{
				...createPetCard('other', 3),
				customSpecies: 'กระต่าย',
				name: 'Fluffy',
				details: 'soft ears',
				has_cage: true,
				image_url: 'image:abc'
			}
		];
		const groups = syncPetsToHousehold(items);
		expect(groups).toEqual([
			{
				species: 'dog',
				count: 1,
				notes: 'ชื่อ: Buddy | brown',
				has_cage: true,
				image_url: null
			},
			{
				species: 'cat',
				count: 1,
				notes: 'ชื่อ: Mochi',
				has_cage: false,
				image_url: null
			},
			{
				species: 'other',
				count: 1,
				notes: 'กระต่าย | ชื่อ: Fluffy | soft ears',
				has_cage: true,
				image_url: 'image:abc'
			}
		]);

		const { items: parsed } = parseInitialPets(groups);
		expect(parsed).toHaveLength(3);
		expect(parsed[0]).toMatchObject({
			species: 'dog',
			name: 'Buddy',
			details: 'brown',
			has_cage: true
		});
		expect(parsed[1]).toMatchObject({ species: 'cat', name: 'Mochi', details: '' });
		expect(parsed[2]).toMatchObject({
			species: 'other',
			customSpecies: 'กระต่าย',
			name: 'Fluffy',
			details: 'soft ears',
			image_url: 'image:abc'
		});
	});
});

describe('getPetTitle', () => {
	it('indexes within species and prefers customSpecies for other', () => {
		const items = [
			createPetCard('dog', 1),
			{ ...createPetCard('other', 2), customSpecies: 'กระต่าย' },
			createPetCard('dog', 3)
		];
		const labels = {
			dogTitle: 'สุนัข',
			catTitle: 'แมว',
			otherPetTitle: 'อื่นๆ',
			petIndexSuffix: 'ตัวที่'
		};
		expect(getPetTitle(items[0]!, items, labels)).toBe('สุนัข — ตัวที่ 1');
		expect(getPetTitle(items[2]!, items, labels)).toBe('สุนัข — ตัวที่ 2');
		expect(getPetTitle(items[1]!, items, labels)).toBe('กระต่าย — ตัวที่ 1');
	});
});
