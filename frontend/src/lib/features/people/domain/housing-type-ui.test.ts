import { describe, it, expect } from 'vitest';
import {
	buildHousingTypeSelectItems,
	DEFAULT_HOUSING_TYPE_ITEMS_TH,
	setHousingTypeFromSelect,
	housingTypeLabelForCode
} from './housing-type-ui';

describe('housing-type-ui (CR-112 Select identity)', () => {
	const defaults = DEFAULT_HOUSING_TYPE_ITEMS_TH;

	it('keeps DEFAULT semantic codes when master only has ULID item codes', () => {
		const items = buildHousingTypeSelectItems({
			defaultItems: defaults,
			masterItems: [
				{
					code: '01HXYZULIDONLY000000000001',
					label_th: 'บ้านตนเอง (ULID)',
					label_en: 'Owned (ULID)',
					status: 'active'
				},
				{
					code: '01HXYZULIDONLY000000000002',
					label_th: 'บ้านเช่า (ULID)',
					label_en: 'Rented (ULID)',
					status: 'active'
				}
			],
			currentValue: 'owned_house'
		});

		expect(items.map((i) => i.value)).toEqual([
			'owned_house',
			'rented_house',
			'condo',
			'apartment_dorm',
			'homeless'
		]);
		expect(items.find((i) => i.value === 'owned_house')?.label).toBe('บ้านตนเอง');
		expect(housingTypeLabelForCode('owned_house', items)).toBe('บ้านตนเอง');
	});

	it('overlays master labels only for matching CR-112 codes', () => {
		const items = buildHousingTypeSelectItems({
			defaultItems: defaults,
			masterItems: [
				{
					code: 'owned_house',
					label_th: 'บ้านของตนเอง (ศูนย์)',
					label_en: 'Owned house (shelter)',
					status: 'active'
				},
				{
					code: '01HXYZULIDONLY000000000001',
					label_th: 'ignored',
					label_en: 'ignored',
					status: 'active'
				},
				{
					code: 'rented_house',
					label_th: 'เช่า',
					label_en: 'Rented',
					status: 'disabled'
				}
			]
		});

		expect(items.find((i) => i.value === 'owned_house')?.label).toBe('บ้านของตนเอง (ศูนย์)');
		// disabled master entry must not replace default label
		expect(items.find((i) => i.value === 'rented_house')?.label).toBe('บ้านเช่า');
		expect(items.some((i) => i.value.startsWith('01H'))).toBe(false);
	});

	it('uses English labels when lang is en', () => {
		const items = buildHousingTypeSelectItems({
			defaultItems: defaults,
			masterItems: [
				{
					code: 'owned_house',
					label_th: 'บ้านของตนเอง',
					label_en: 'Owned house',
					status: 'active'
				}
			],
			lang: 'en'
		});
		expect(items.find((i) => i.value === 'owned_house')?.label).toBe('Owned house');
	});

	it('appends an orphan option so a pre-reg code still displays when missing from master', () => {
		const items = buildHousingTypeSelectItems({
			defaultItems: defaults.filter((d) => d.value !== 'condo'),
			masterItems: [],
			currentValue: 'condo',
			labelForCode: (code, fallback) => (code === 'condo' ? 'คอนโดมิเนียม' : fallback)
		});

		expect(items.some((i) => i.value === 'condo')).toBe(true);
		expect(housingTypeLabelForCode('condo', items)).toBe('คอนโดมิเนียม');
	});

	it('does not clear existing value when Select sync emits empty string', () => {
		let housing_type: string | null = 'owned_house';
		setHousingTypeFromSelect('', (v) => {
			housing_type = v;
		});
		expect(housing_type).toBe('owned_house');

		setHousingTypeFromSelect('rented_house', (v) => {
			housing_type = v;
		});
		expect(housing_type).toBe('rented_house');
	});
});
