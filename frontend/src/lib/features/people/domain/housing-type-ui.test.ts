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
				{ code: '01HXYZULIDONLY000000000001', label: 'บ้านตนเอง (ULID)', status: 'active' },
				{ code: '01HXYZULIDONLY000000000002', label: 'บ้านเช่า (ULID)', status: 'active' }
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
				{ code: 'owned_house', label: 'บ้านของตนเอง (ศูนย์)', status: 'active' },
				{ code: '01HXYZULIDONLY000000000001', label: 'ignored', status: 'active' },
				{ code: 'rented_house', label: 'เช่า', status: 'disabled' }
			]
		});

		expect(items.find((i) => i.value === 'owned_house')?.label).toBe('บ้านของตนเอง (ศูนย์)');
		// disabled master entry must not replace default label
		expect(items.find((i) => i.value === 'rented_house')?.label).toBe('บ้านเช่า');
		expect(items.some((i) => i.value.startsWith('01H'))).toBe(false);
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
